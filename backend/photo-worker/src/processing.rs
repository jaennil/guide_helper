use anyhow::{anyhow, Context, Result};
use aws_sdk_s3::Client as S3Client;
use aws_sdk_s3::primitives::ByteStream;
use image::imageops::FilterType;
use image::ImageFormat;
use std::io::Cursor;

/// Decodes a data URL (e.g. "data:image/jpeg;base64,/9j/4AAQ...") into raw bytes.
pub fn decode_data_url(data_url: &str) -> Result<Vec<u8>> {
    let comma_pos = data_url
        .find(',')
        .ok_or_else(|| anyhow!("invalid data URL: no comma separator"))?;

    let header = &data_url[..comma_pos];
    if !header.contains("base64") {
        return Err(anyhow!("invalid data URL: not base64 encoded"));
    }

    let encoded = &data_url[comma_pos + 1..];
    let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .context("failed to decode base64 data")?;

    tracing::debug!(
        decoded_size = decoded.len(),
        "decoded data URL to raw bytes"
    );

    Ok(decoded)
}

/// Compresses an image: resizes if wider than max_width, encodes as JPEG with given quality.
pub fn compress_image(data: &[u8], max_width: u32, quality: u8) -> Result<Vec<u8>> {
    let img = image::load_from_memory(data).context("failed to load image from memory")?;

    let img = if img.width() > max_width {
        let ratio = max_width as f64 / img.width() as f64;
        let new_height = (img.height() as f64 * ratio) as u32;
        tracing::debug!(
            original_width = img.width(),
            original_height = img.height(),
            new_width = max_width,
            new_height = new_height,
            "resizing image"
        );
        img.resize(max_width, new_height, FilterType::Lanczos3)
    } else {
        img
    };

    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, ImageFormat::Jpeg)
        .context("failed to encode image as JPEG")?;

    let result = buf.into_inner();
    tracing::debug!(
        output_size = result.len(),
        quality = quality,
        "compressed image to JPEG"
    );

    Ok(result)
}

/// Creates a small thumbnail from raw image data.
pub fn create_thumbnail(data: &[u8], width: u32) -> Result<Vec<u8>> {
    let img = image::load_from_memory(data).context("failed to load image for thumbnail")?;

    let ratio = width as f64 / img.width() as f64;
    let height = (img.height() as f64 * ratio) as u32;
    let thumb = img.resize(width, height, FilterType::Lanczos3);

    let mut buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, ImageFormat::Jpeg)
        .context("failed to encode thumbnail as JPEG")?;

    let result = buf.into_inner();
    tracing::debug!(
        thumb_width = width,
        thumb_height = height,
        output_size = result.len(),
        "created thumbnail"
    );

    Ok(result)
}

/// Uploads data to S3/MinIO.
pub async fn upload_to_s3(
    client: &S3Client,
    bucket: &str,
    key: &str,
    data: Vec<u8>,
    content_type: &str,
) -> Result<()> {
    let body = ByteStream::from(data);

    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(body)
        .content_type(content_type)
        .send()
        .await
        .context("failed to upload to S3")?;

    tracing::debug!(bucket = bucket, key = key, "uploaded object to S3");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_data_url_valid() {
        let data_url = "data:image/png;base64,aGVsbG8=";
        let result = decode_data_url(data_url).unwrap();
        assert_eq!(result, b"hello");
    }

    #[test]
    fn test_decode_data_url_no_comma() {
        let data_url = "data:image/pngbase64aGVsbG8=";
        assert!(decode_data_url(data_url).is_err());
    }

    #[test]
    fn test_decode_data_url_not_base64() {
        let data_url = "data:image/png,aGVsbG8=";
        assert!(decode_data_url(data_url).is_err());
    }
}
