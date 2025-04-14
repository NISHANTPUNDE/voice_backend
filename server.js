// server.js
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

// Set FFmpeg binary path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Serve static files with appropriate MIME types
app.use("/uploads", (req, res, next) => {
    if (req.path.endsWith('.mp3')) {
        res.set('Content-Type', 'audio/mpeg');
    }
    next();
}, express.static(uploadDir));

// Multer storage setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads"),
    filename: (req, file, cb) => {
        // Generate a unique filename
        cb(null, `audio_${Date.now()}${path.extname(file.originalname)}`);
    },
});

const upload = multer({ storage });

/**
 * Upload & convert to MP3
 */
app.post("/upload", upload.single("audio"), (req, res) => {
    const inputPath = req.file.path;
    const outputFileName = `mp3_recording_${Date.now()}.mp3`;
    const outputPath = path.join(uploadDir, outputFileName);

    // Log the input file info
    console.log(`Processing file: ${inputPath}`);

    ffmpeg()
        .input(inputPath)
        .outputOptions([
            '-c:a libmp3lame',       // Use MP3 codec
            '-b:a 128k',             // Set bitrate to 128kbps
            '-ar 44100',             // Set sample rate to 44.1kHz
            '-ac 2',                 // Set 2 audio channels (stereo)
        ])
        .on('start', (commandLine) => {
            console.log('FFmpeg started with command:', commandLine);
        })
        .on("end", () => {
            console.log(`Successfully converted ${inputPath} to ${outputPath}`);

            // Delete original file
            fs.unlink(inputPath, err => {
                if (err) console.error(`Error deleting original file: ${err.message}`);
            });

            // Send response
            res.json({
                success: true,
                url: `/uploads/${outputFileName}`,
                message: "Audio successfully converted to MP3"
            });
        })
        .on("error", (err) => {
            console.error("FFmpeg error:", err);

            // Keep original file for debugging
            res.status(500).json({
                success: false,
                message: "Conversion failed",
                error: err.message
            });
        })
        .save(outputPath);
});

/**
 * List all MP3 files
 */
app.get("/audios", (req, res) => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) {
            console.error("Directory read error:", err);
            return res.status(500).json({ error: "Failed to read directory" });
        }

        // Filter for MP3 files and sort by creation time (newest first)
        const audioFiles = files
            .filter(f => f.endsWith(".mp3"))
            .map(filename => {
                const filePath = path.join(uploadDir, filename);
                const stats = fs.statSync(filePath);
                return {
                    filename,
                    created: stats.birthtime
                };
            })
            .sort((a, b) => b.created - a.created)
            .map(file => `/uploads/${file.filename}`);

        res.json({ files: audioFiles });
    });
});

/**
 * Stream audio with Range support
 */
app.get("/stream/:filename", (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            return res.status(404).send("File not found");
        }

        const range = req.headers.range;
        const fileSize = stats.size;

        if (!range) {
            // If no range header, serve the full file
            res.writeHead(200, {
                "Content-Length": fileSize,
                "Content-Type": "audio/mpeg",
            });
            fs.createReadStream(filePath).pipe(res);
            return;
        }

        // Parse range header
        const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
            return res.status(416).send("Range Not Satisfiable");
        }

        const chunkSize = end - start + 1;
        const headers = {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize,
            "Content-Type": "audio/mpeg",
        };

        res.writeHead(206, headers);
        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
    });
});

// Health check route
app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ MP3 Voice Recorder server running at http://localhost:${PORT}`);
});