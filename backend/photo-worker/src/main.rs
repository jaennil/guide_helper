mod config;
mod domain;
mod processing;
mod telemetry;

use std::time::Duration;

use anyhow::Context;
use aws_sdk_s3::Client as S3Client;
use sqlx::PgPool;

use crate::config::AppConfig;
use crate::domain::{PhotoData, PhotoProcessTask, PhotoStatus, Route};
use crate::processing::{compress_image, create_thumbnail, decode_data_url, upload_to_s3};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    telemetry::init_subscriber();
    tracing::info!("starting photo-worker");

    let config = AppConfig::from_env();
    tracing::info!(
        nats_url = %config.nats_url,
        minio_endpoint = %config.minio_endpoint,
        "config loaded"
    );

    // Connect to PostgreSQL
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .connect(&config.database_url)
        .await
        .context("failed to connect to database")?;
    tracing::info!("connected to database");

    // Connect to MinIO/S3
    let s3_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .endpoint_url(&config.minio_endpoint)
        .region(aws_config::Region::new("us-east-1"))
        .credentials_provider(aws_sdk_s3::config::Credentials::new(
            &config.minio_access_key,
            &config.minio_secret_key,
            None,
            None,
            "env",
        ))
        .load()
        .await;
    let s3_client = S3Client::from_conf(
        aws_sdk_s3::Config::from(&s3_config)
            .to_builder()
            .force_path_style(true)
            .build(),
    );
    tracing::info!("S3 client configured");

    // Ensure bucket exists with public-read policy
    ensure_bucket(&s3_client, &config.minio_bucket).await?;

    // Connect to NATS
    let nats_client = async_nats::connect(&config.nats_url)
        .await
        .context("failed to connect to NATS")?;
    tracing::info!(nats_url = %config.nats_url, "connected to NATS");

    let nats_publisher = nats_client.clone();
    let jetstream = async_nats::jetstream::new(nats_client);

    // Create consumer for photo processing
    let stream = jetstream
        .get_stream("PHOTOS")
        .await
        .context("failed to get PHOTOS stream")?;
    tracing::info!("got PHOTOS stream");

    let consumer = stream
        .get_or_create_consumer(
            "photo-worker",
            async_nats::jetstream::consumer::pull::Config {
                durable_name: Some("photo-worker".to_string()),
                ack_wait: Duration::from_secs(120),
                max_deliver: 3,
                ..Default::default()
            },
        )
        .await
        .context("failed to create consumer")?;
    tracing::info!("consumer ready, starting message loop");

    // Process messages
    loop {
        let mut messages = match consumer.fetch().max_messages(1).messages().await {
            Ok(msgs) => msgs,
            Err(e) => {
                tracing::error!(error = %e, "failed to fetch messages");
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };

        use futures::StreamExt;
        while let Some(msg_result) = messages.next().await {
            match msg_result {
                Ok(msg) => {
                    if let Err(e) =
                        process_message(&msg, &pool, &s3_client, &config, &nats_publisher).await
                    {
                        tracing::error!(error = %e, "failed to process message");
                        // Message will be redelivered by NATS
                    } else if let Err(e) = msg.ack().await {
                        tracing::error!(error = %e, "failed to ack message");
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "error receiving message");
                }
            }
        }

        // Small delay between fetch batches
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn process_message(
    msg: &async_nats::jetstream::message::Message,
    pool: &PgPool,
    s3_client: &S3Client,
    config: &AppConfig,
    nats_publisher: &async_nats::Client,
) -> anyhow::Result<()> {
    let task: PhotoProcessTask =
        serde_json::from_slice(&msg.payload).context("failed to deserialize task")?;

    tracing::info!(
        route_id = %task.route_id,
        user_id = %task.user_id,
        point_count = task.point_indices.len(),
        "processing photo task"
    );

    // Fetch route from database
    let route: Route = sqlx::query_as(
        "SELECT id, user_id, name, points, created_at, updated_at FROM routes WHERE id = $1",
    )
    .bind(task.route_id)
    .fetch_one(pool)
    .await
    .context("failed to fetch route from database")?;

    let mut points = route.points;
    let mut processed_count = 0;

    for &idx in &task.point_indices {
        if idx >= points.len() {
            tracing::warn!(
                route_id = %task.route_id,
                point_index = idx,
                "point index out of bounds, skipping"
            );
            continue;
        }

        let photo = match &points[idx].photo {
            Some(p) if p.original.starts_with("data:") => p,
            _ => {
                tracing::debug!(
                    route_id = %task.route_id,
                    point_index = idx,
                    "point has no base64 photo, skipping"
                );
                continue;
            }
        };

        tracing::info!(
            route_id = %task.route_id,
            point_index = idx,
            original_len = photo.original.len(),
            "processing photo"
        );

        // Decode base64
        let raw_data = match decode_data_url(&photo.original) {
            Ok(data) => data,
            Err(e) => {
                tracing::error!(
                    route_id = %task.route_id,
                    point_index = idx,
                    error = %e,
                    "failed to decode data URL"
                );
                points[idx].photo = Some(PhotoData {
                    original: photo.original.clone(),
                    thumbnail_url: None,
                    status: PhotoStatus::Failed,
                });
                continue;
            }
        };

        // Compress full image
        let compressed = match compress_image(&raw_data, config.photo_max_width, config.photo_quality)
        {
            Ok(data) => data,
            Err(e) => {
                tracing::error!(
                    route_id = %task.route_id,
                    point_index = idx,
                    error = %e,
                    "failed to compress image"
                );
                points[idx].photo = Some(PhotoData {
                    original: photo.original.clone(),
                    thumbnail_url: None,
                    status: PhotoStatus::Failed,
                });
                continue;
            }
        };

        // Create thumbnail
        let thumbnail = match create_thumbnail(&raw_data, config.thumbnail_width) {
            Ok(data) => data,
            Err(e) => {
                tracing::error!(
                    route_id = %task.route_id,
                    point_index = idx,
                    error = %e,
                    "failed to create thumbnail"
                );
                points[idx].photo = Some(PhotoData {
                    original: photo.original.clone(),
                    thumbnail_url: None,
                    status: PhotoStatus::Failed,
                });
                continue;
            }
        };

        // Upload to MinIO
        let photo_key = format!("{}/{}/photo_{}.jpg", task.user_id, task.route_id, idx);
        let thumb_key = format!("{}/{}/thumb_{}.jpg", task.user_id, task.route_id, idx);

        if let Err(e) = upload_to_s3(
            s3_client,
            &config.minio_bucket,
            &photo_key,
            compressed,
            "image/jpeg",
        )
        .await
        {
            tracing::error!(
                route_id = %task.route_id,
                point_index = idx,
                error = %e,
                "failed to upload photo to S3"
            );
            points[idx].photo = Some(PhotoData {
                original: photo.original.clone(),
                thumbnail_url: None,
                status: PhotoStatus::Failed,
            });
            continue;
        }

        if let Err(e) = upload_to_s3(
            s3_client,
            &config.minio_bucket,
            &thumb_key,
            thumbnail,
            "image/jpeg",
        )
        .await
        {
            tracing::error!(
                route_id = %task.route_id,
                point_index = idx,
                error = %e,
                "failed to upload thumbnail to S3"
            );
            points[idx].photo = Some(PhotoData {
                original: format!("{}/{}", config.photo_base_url, photo_key),
                thumbnail_url: None,
                status: PhotoStatus::Failed,
            });
            continue;
        }

        // Update point with URLs
        let photo_url = format!("{}/{}", config.photo_base_url, photo_key);
        let thumb_url = format!("{}/{}", config.photo_base_url, thumb_key);

        tracing::info!(
            route_id = %task.route_id,
            point_index = idx,
            photo_url = %photo_url,
            thumb_url = %thumb_url,
            "photo processed successfully"
        );

        points[idx].photo = Some(PhotoData {
            original: photo_url,
            thumbnail_url: Some(thumb_url),
            status: PhotoStatus::Done,
        });
        processed_count += 1;
    }

    // Update route in database
    let points_json =
        serde_json::to_value(&points).context("failed to serialize updated points")?;

    sqlx::query("UPDATE routes SET points = $2, updated_at = NOW() WHERE id = $1")
        .bind(task.route_id)
        .bind(&points_json)
        .execute(pool)
        .await
        .context("failed to update route in database")?;

    // Publish completion event via core NATS for real-time WS notifications
    let subject = format!("photos.completed.{}", task.route_id);
    let payload = serde_json::json!({
        "type": "photo_update",
        "route_id": task.route_id.to_string(),
        "points": points_json,
    });
    match serde_json::to_vec(&payload) {
        Ok(bytes) => {
            if let Err(e) = nats_publisher.publish(subject.clone(), bytes.into()).await {
                tracing::warn!(
                    route_id = %task.route_id,
                    error = %e,
                    "failed to publish photo completion event"
                );
            } else {
                tracing::info!(
                    route_id = %task.route_id,
                    subject = %subject,
                    "published photo completion event"
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                route_id = %task.route_id,
                error = %e,
                "failed to serialize photo completion payload"
            );
        }
    }

    tracing::info!(
        route_id = %task.route_id,
        processed = processed_count,
        total = task.point_indices.len(),
        "photo task completed"
    );

    Ok(())
}

async fn ensure_bucket(s3_client: &S3Client, bucket: &str) -> anyhow::Result<()> {
    match s3_client.head_bucket().bucket(bucket).send().await {
        Ok(_) => {
            tracing::info!(bucket = bucket, "bucket already exists");
        }
        Err(_) => {
            tracing::info!(bucket = bucket, "creating bucket");
            s3_client
                .create_bucket()
                .bucket(bucket)
                .send()
                .await
                .context("failed to create bucket")?;
            tracing::info!(bucket = bucket, "bucket created");

            // Set public-read policy
            let policy = serde_json::json!({
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [format!("arn:aws:s3:::{}/*", bucket)]
                }]
            });

            s3_client
                .put_bucket_policy()
                .bucket(bucket)
                .policy(policy.to_string())
                .send()
                .await
                .context("failed to set bucket policy")?;
            tracing::info!(bucket = bucket, "bucket policy set to public-read");
        }
    }

    Ok(())
}
