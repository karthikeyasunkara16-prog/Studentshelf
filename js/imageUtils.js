/**
 * Client-Side Image Compression & Processing Utility
 * Prevents Firestore 1MB document size limit errors by strictly optimizing
 * all user photos down to ~100KB-180KB via HTML5 Canvas before upload.
 */

/**
 * Compresses an image File or Blob using HTML5 Canvas.
 * @param {File|Blob} file - The raw image file from input
 * @param {number} maxDimension - Max width/height in px (default: 1024)
 * @param {number} maxSizeBytes - Target max byte size in bytes (default: 190KB)
 * @returns {Promise<{ dataUrl: string, sizeBytes: number, width: number, height: number }>}
 */
export async function compressImage(file, maxDimension = 1024, maxSizeBytes = 190 * 1024) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            return reject(new Error('Selected file is not an image.'));
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Failed to decode image data.'));
            
            img.onload = () => {
                let { width, height } = img;

                // 1. Maintain aspect ratio while bounding within maxDimension (1024px)
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d', { alpha: false });

                // Fill crisp white background (handles transparent PNG/WebP gracefully)
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);

                // High-quality canvas image drawing
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                // 2. Iterative compression loop to ensure < 190 KB
                let quality = 0.75;
                let dataUrl = canvas.toDataURL('image/jpeg', quality);

                // Estimate byte size from Base64 string length: (len * 3 / 4)
                let estSize = Math.round(dataUrl.length * 0.75);

                while (estSize > maxSizeBytes && quality > 0.35) {
                    quality -= 0.10;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                    estSize = Math.round(dataUrl.length * 0.75);
                }

                // If still above maxSizeBytes, downscale canvas dimensions
                if (estSize > maxSizeBytes) {
                    const scaledCanvas = document.createElement('canvas');
                    scaledCanvas.width = Math.round(width * 0.75);
                    scaledCanvas.height = Math.round(height * 0.75);
                    const sCtx = scaledCanvas.getContext('2d', { alpha: false });
                    sCtx.fillStyle = '#FFFFFF';
                    sCtx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
                    sCtx.imageSmoothingEnabled = true;
                    sCtx.imageSmoothingQuality = 'medium';
                    sCtx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

                    dataUrl = scaledCanvas.toDataURL('image/jpeg', 0.60);
                    estSize = Math.round(dataUrl.length * 0.75);
                    width = scaledCanvas.width;
                    height = scaledCanvas.height;
                }

                resolve({
                    dataUrl,
                    sizeBytes: estSize,
                    sizeKb: Math.round(estSize / 1024),
                    width,
                    height
                });
            };

            img.src = e.target.result;
        };

        reader.readAsDataURL(file);
    });
}

/**
 * Helper to compress multiple files sequentially with progress reporting.
 * @param {FileList|File[]} files - Selected files
 * @param {Function} onProgress - Optional callback (current, total)
 * @returns {Promise<Array<{ dataUrl: string, sizeBytes: number, sizeKb: number }>>}
 */
export async function compressMultipleImages(files, onProgress = null) {
    const list = Array.from(files);
    const results = [];

    for (let i = 0; i < list.length; i++) {
        const file = list[i];
        if (onProgress) {
            onProgress(i + 1, list.length);
        }
        const compressed = await compressImage(file);
        results.push(compressed);
    }

    return results;
}
