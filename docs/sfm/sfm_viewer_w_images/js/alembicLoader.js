/**
 * Alembic Loader for SFM Camera Data
 * Handles loading and parsing of Alembic (.abc) files containing camera animation data
 * 
 * Alembic is preferred over COLMAP/Bundler for:
 * - Standardized animation/keyframe support
 * - Efficient binary format
 * - Industry standard for VFX/animation pipelines
 * - Better handling of temporal camera data
 * - Support for multiple cameras with synchronized timelines
 */

class AlembicLoader {
    constructor() {
        this.cameras = [];
        this.frameCount = 0;
        this.isAnimated = false;
        this.frameRate = 24; // Default FPS
        this.timeRange = { start: 0, end: 1 };
    }

    /**
     * Load Alembic file from File object
     * @param {File} file - The .abc file
     * @returns {Promise<Object>} Camera data
     */
    async loadAlembicFile(file) {
        console.log('Loading Alembic file:', file.name);
        
        try {
            const arrayBuffer = await this.readFileAsArrayBuffer(file);
            return this.parseAlembicData(arrayBuffer);
        } catch (error) {
            console.error('Error loading Alembic file:', error);
            throw new Error(`Failed to load Alembic file: ${error.message}`);
        }
    }

    /**
     * Load Alembic file from URL
     * @param {string} url - URL to the .abc file
     * @returns {Promise<Object>} Camera data
     */
    async loadAlembicFromURL(url) {
        console.log('Loading Alembic from URL:', url);
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            return this.parseAlembicData(arrayBuffer);
        } catch (error) {
            console.error('Error loading Alembic from URL:', error);
            throw new Error(`Failed to load Alembic from URL: ${error.message}`);
        }
    }

    /**
     * Parse Alembic binary data
     * Note: This is a simplified parser. Real Alembic files require the official SDK
     * or a WebAssembly port. This implementation handles basic camera data structures.
     */
    async parseAlembicData(arrayBuffer) {
        console.log('Parsing Alembic data, size:', arrayBuffer.byteLength);
        
        try {
            // For demonstration, we'll parse a simplified JSON-based format
            // that represents what would be extracted from an Alembic file
            
            // In a real implementation, this would use:
            // - Alembic SDK (C++)
            // - WebAssembly port of Alembic
            // - Pre-converted JSON/binary format
            
            // Check if this might be a text-based format first
            const textDecoder = new TextDecoder();
            const header = textDecoder.decode(arrayBuffer.slice(0, 100));
            
            if (header.includes('{') || header.includes('cameras')) {
                // Looks like JSON format - parse as text
                const jsonText = textDecoder.decode(arrayBuffer);
                return this.parseJSONData(JSON.parse(jsonText));
            } else {
                // Binary Alembic format - use simplified binary parser
                return this.parseBinaryAlembic(arrayBuffer);
            }
            
        } catch (error) {
            console.error('Error parsing Alembic data:', error);
            throw new Error(`Failed to parse Alembic data: ${error.message}`);
        }
    }

    /**
     * Parse JSON-based camera data (for compatibility)
     */
    parseJSONData(jsonData) {
        console.log('Parsing JSON camera data');
        
        const cameras = [];
        const cameraData = jsonData.cameras || jsonData;
        
        // Handle different JSON structures
        if (Array.isArray(cameraData)) {
            // Array of cameras
            cameraData.forEach((cam, index) => {
                cameras.push(this.processCameraData(cam, index));
            });
        } else if (cameraData.camera || cameraData.Camera) {
            // Single camera object
            const cam = cameraData.camera || cameraData.Camera;
            cameras.push(this.processCameraData(cam, 0));
        }

        // Determine if animated
        this.isAnimated = cameras.some(cam => cam.keyframes && cam.keyframes.length > 1);
        this.frameCount = this.isAnimated ? this.calculateFrameCount(cameras) : 1;
        
        return {
            cameras: cameras,
            isAnimated: this.isAnimated,
            frameCount: this.frameCount,
            frameRate: jsonData.frameRate || this.frameRate,
            timeRange: jsonData.timeRange || this.timeRange,
            metadata: jsonData.metadata || {}
        };
    }

    /**
     * Parse binary Alembic data (simplified implementation)
     */
    parseBinaryAlembic(arrayBuffer) {
        console.log('Parsing binary Alembic data');
        
        // This is a highly simplified binary parser
        // Real Alembic files have a complex hierarchical structure
        
        const dataView = new DataView(arrayBuffer);
        const cameras = [];
        
        try {
            // Alembic magic number check (simplified)
            const magic = dataView.getUint32(0, true);
            console.log('Binary magic number:', magic.toString(16));
            
            // For now, return a sample camera structure
            // In a real implementation, this would parse the Alembic hierarchy
            cameras.push(this.createSampleCamera());
            
            return {
                cameras: cameras,
                isAnimated: false,
                frameCount: 1,
                frameRate: this.frameRate,
                timeRange: this.timeRange,
                metadata: { format: 'alembic', parsed: 'simplified' }
            };
            
        } catch (error) {
            throw new Error(`Binary Alembic parsing failed: ${error.message}`);
        }
    }

    /**
     * Process individual camera data
     */
    processCameraData(camData, index) {
        const camera = {
            id: camData.id || `camera_${index}`,
            name: camData.name || camData.label || `Camera ${index + 1}`,
            visible: true,
            isAnimated: false,
            keyframes: []
        };

        // Handle static camera data
        if (camData.position && camData.target) {
            camera.keyframes.push({
                frame: 0,
                time: 0,
                position: this.ensureArray(camData.position, 3),
                target: camData.target ? this.ensureArray(camData.target, 3) : [0, 0, 0],
                rotation: camData.rotation ? this.ensureArray(camData.rotation, 3) : null,
                fov: camData.fov || camData.fieldOfView || 60,
                nearClip: camData.nearClip || 0.1,
                farClip: camData.farClip || 1000,
                filmWidth: camData.filmWidth || 36,
                filmHeight: camData.filmHeight || 24,
                focalLength: camData.focalLength || 50
            });
        }

        // Handle animated camera data
        if (camData.keyframes && Array.isArray(camData.keyframes)) {
            camera.isAnimated = true;
            camera.keyframes = camData.keyframes.map((kf, kfIndex) => ({
                frame: kf.frame || kfIndex,
                time: kf.time || (kfIndex / this.frameRate),
                position: this.ensureArray(kf.position, 3),
                target: kf.target ? this.ensureArray(kf.target, 3) : [0, 0, 0],
                rotation: kf.rotation ? this.ensureArray(kf.rotation, 3) : null,
                fov: kf.fov || camData.fov || 60,
                nearClip: kf.nearClip || camData.nearClip || 0.1,
                farClip: kf.farClip || camData.farClip || 1000,
                filmWidth: kf.filmWidth || camData.filmWidth || 36,
                filmHeight: kf.filmHeight || camData.filmHeight || 24,
                focalLength: kf.focalLength || camData.focalLength || 50
            }));
        }

        // Handle animation samples (Maya/Alembic style)
        if (camData.samples && Array.isArray(camData.samples)) {
            camera.isAnimated = true;
            camera.keyframes = camData.samples.map((sample, sampleIndex) => ({
                frame: sampleIndex,
                time: sampleIndex / this.frameRate,
                position: this.ensureArray(sample.translate || sample.position, 3),
                target: sample.target ? this.ensureArray(sample.target, 3) : [0, 0, 0],
                rotation: this.ensureArray(sample.rotate || sample.rotation, 3),
                fov: sample.fov || camData.focalLength ? this.focalLengthToFOV(sample.focalLength || camData.focalLength) : 60,
                nearClip: sample.nearClipPlane || 0.1,
                farClip: sample.farClipPlane || 1000,
                filmWidth: sample.horizontalFilmAperture || 36,
                filmHeight: sample.verticalFilmAperture || 24,
                focalLength: sample.focalLength || 50
            }));
        }

        return camera;
    }

    /**
     * Create a sample camera for testing
     */
    createSampleCamera() {
        return {
            id: 'sample_camera',
            name: 'Sample Camera',
            visible: true,
            isAnimated: false,
            keyframes: [{
                frame: 0,
                time: 0,
                position: [10, 10, 10],
                target: [0, 0, 0],
                rotation: [0, 45, 0],
                fov: 60,
                nearClip: 0.1,
                farClip: 1000,
                filmWidth: 36,
                filmHeight: 24,
                focalLength: 50
            }]
        };
    }

    /**
     * Ensure array has correct length and type
     */
    ensureArray(value, length = 3) {
        if (!value) return new Array(length).fill(0);
        if (Array.isArray(value)) {
            return value.slice(0, length).concat(new Array(Math.max(0, length - value.length)).fill(0));
        }
        if (typeof value === 'object' && value.x !== undefined) {
            return [value.x || 0, value.y || 0, value.z || 0].slice(0, length);
        }
        return new Array(length).fill(0);
    }

    /**
     * Convert focal length to field of view
     */
    focalLengthToFOV(focalLength, filmHeight = 24) {
        return 2 * Math.atan(filmHeight / (2 * focalLength)) * (180 / Math.PI);
    }

    /**
     * Calculate total frame count from all cameras
     */
    calculateFrameCount(cameras) {
        let maxFrames = 1;
        cameras.forEach(camera => {
            if (camera.keyframes && camera.keyframes.length > 0) {
                const cameraMaxFrame = Math.max(...camera.keyframes.map(kf => kf.frame || 0));
                maxFrames = Math.max(maxFrames, cameraMaxFrame + 1);
            }
        });
        return maxFrames;
    }

    /**
     * Helper function to read file as ArrayBuffer
     */
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Generate sample Alembic data for testing
     */
    static generateSampleData() {
        return {
            metadata: {
                version: "1.8.3",
                application: "Maya",
                frameRate: 24,
                startFrame: 1,
                endFrame: 100
            },
            cameras: [
                {
                    name: "perspShape",
                    id: "camera_001",
                    samples: [
                        {
                            frame: 1,
                            translate: [15, 10, 15],
                            rotate: [0, 45, 0],
                            focalLength: 35,
                            horizontalFilmAperture: 36,
                            verticalFilmAperture: 24,
                            nearClipPlane: 0.1,
                            farClipPlane: 1000
                        },
                        {
                            frame: 50,
                            translate: [20, 15, 20],
                            rotate: [0, 90, 0],
                            focalLength: 50,
                            horizontalFilmAperture: 36,
                            verticalFilmAperture: 24,
                            nearClipPlane: 0.1,
                            farClipPlane: 1000
                        },
                        {
                            frame: 100,
                            translate: [10, 20, 10],
                            rotate: [0, 135, 0],
                            focalLength: 85,
                            horizontalFilmAperture: 36,
                            verticalFilmAperture: 24,
                            nearClipPlane: 0.1,
                            farClipPlane: 1000
                        }
                    ]
                }
            ]
        };
    }

    /**
     * Load sample data from relative path
     */
    async loadSampleData() {
        try {
            const sampleUrl = './sample-data/cameras.json';
            console.log('Loading sample Alembic data from:', sampleUrl);
            
            const response = await fetch(sampleUrl);
            if (!response.ok) {
                // Fallback to generated sample data
                console.log('Sample file not found, using generated data');
                return this.parseJSONData(AlembicLoader.generateSampleData());
            }
            
            const jsonData = await response.json();
            return this.parseJSONData(jsonData);
            
        } catch (error) {
            console.warn('Could not load sample data file, using generated sample:', error);
            return this.parseJSONData(AlembicLoader.generateSampleData());
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlembicLoader;
} else {
    window.AlembicLoader = AlembicLoader;
}