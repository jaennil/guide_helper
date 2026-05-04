const ROUTE_PHOTO_MAX_DIMENSION = 1280;
const ROUTE_PHOTO_JPEG_QUALITY = 0.78;

function readFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Failed to read file as data URL"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

export async function imageFileToRoutePhotoDataUrl(file: File) {
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    return readFileAsDataUrl(file);
  }

  try {
    const image = await loadImage(file);
    const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = largestSide > ROUTE_PHOTO_MAX_DIMENSION
      ? ROUTE_PHOTO_MAX_DIMENSION / largestSide
      : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      return readFileAsDataUrl(file);
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", ROUTE_PHOTO_JPEG_QUALITY);
    if (!blob) {
      return readFileAsDataUrl(file);
    }

    return readFileAsDataUrl(blob);
  } catch (error) {
    console.warn("[photo] failed to resize image, using original file:", error);
    return readFileAsDataUrl(file);
  }
}
