const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3080;

// Configure storage folder - default to host-mounted directory when provided
const DEFAULT_UPLOAD_FOLDER = path.join(__dirname, 'uploads');
let uploadFolder = process.env.UPLOAD_FOLDER || '/home/ljiahao/apks';

try {
    if (!fsSync.existsSync(uploadFolder)) {
        fsSync.mkdirSync(uploadFolder, { recursive: true });
    }
} catch (error) {
    console.warn(`Unable to access configured upload folder "${uploadFolder}", falling back to default.`, error);
    uploadFolder = DEFAULT_UPLOAD_FOLDER;
    if (!fsSync.existsSync(uploadFolder)) {
        fsSync.mkdirSync(uploadFolder, { recursive: true });
    }
}

const UPLOAD_FOLDER = uploadFolder;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_FOLDER);
    },
    filename: (req, file, cb) => {
        // Keep original filename
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve uploaded files
app.use('/uploads', express.static(UPLOAD_FOLDER));

// Get all files
app.get('/api/files', async (req, res) => {
    try {
        const files = await fs.readdir(UPLOAD_FOLDER);
        const fileDetails = await Promise.all(
            files.map(async (filename) => {
                const filePath = path.join(UPLOAD_FOLDER, filename);
                const stats = await fs.stat(filePath);
                
                return {
                    name: filename,
                    size: stats.size,
                    uploadDate: stats.mtime,
                    path: `/uploads/${filename}`
                };
            })
        );
        
        res.json(fileDetails);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read files' });
    }
});

// Upload files
app.post('/api/upload', upload.array('files'), (req, res) => {
    try {
        const uploadedFiles = req.files.map(file => ({
            name: file.filename,
            size: file.size,
            path: `/uploads/${file.filename}`
        }));
        
        res.json({ 
            message: 'Files uploaded successfully',
            files: uploadedFiles 
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to upload files' });
    }
});

// Download file
app.get('/api/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(UPLOAD_FOLDER, filename);
    
    res.download(filePath, filename, (err) => {
        if (err) {
            res.status(404).json({ error: 'File not found' });
        }
    });
});

// Read file content (for editing text files)
app.get('/api/file/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(UPLOAD_FOLDER, filename);
        const content = await fs.readFile(filePath, 'utf8');
        
        res.json({ content });
    } catch (error) {
        res.status(500).json({ error: 'Failed to read file' });
    }
});

// Update file
app.put('/api/file/:filename', async (req, res) => {
    try {
        const oldFilename = req.params.filename;
        const { newName, content } = req.body;
        const oldPath = path.join(UPLOAD_FOLDER, oldFilename);
        
        // Update content if provided
        if (content !== undefined) {
            await fs.writeFile(oldPath, content, 'utf8');
        }
        
        // Rename file if new name provided
        if (newName && newName !== oldFilename) {
            const newPath = path.join(UPLOAD_FOLDER, newName);
            await fs.rename(oldPath, newPath);
        }
        
        res.json({ 
            message: 'File updated successfully',
            filename: newName || oldFilename
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update file' });
    }
});

// Delete file
app.delete('/api/file/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(UPLOAD_FOLDER, filename);
        
        await fs.unlink(filePath);
        
        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║   File Manager Server Running              ║
║                                            ║
║   📁 Host Folder: ${UPLOAD_FOLDER}
║   🌐 Server: http://localhost:${PORT}      ║
║                                            ║
║   All files are stored at the path above ║
║   on your server filesystem              ║
╚════════════════════════════════════════════╝
    `);
});
