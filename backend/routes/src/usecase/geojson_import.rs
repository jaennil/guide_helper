use geojson::{Feature, FeatureCollection, GeoJson, Geometry, Value};
use thiserror::Error;

use crate::domain::route::RoutePoint;

#[derive(Debug, Error)]
pub enum ImportError {
    #[error("invalid GeoJSON: {0}")]
    InvalidGeoJson(String),
    #[error("missing route name in properties")]
    MissingRouteName,
    #[error("empty route: no coordinates or points found")]
    EmptyRoute,
    #[error("unsupported geometry type: expected LineString or FeatureCollection of Points")]
    UnsupportedGeometry,
}

/// Parses GeoJSON content and extracts route name and points.
///
/// Supports two formats:
/// A) Feature with LineString geometry:
///    { "type": "Feature", "properties": {"name": "..."}, "geometry": {"type": "LineString", "coordinates": [[lng, lat], ...]}}
///
/// B) FeatureCollection with Point features:
///    { "type": "FeatureCollection", "properties": {"name": "..."}, "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [lng, lat]}, "properties": {"name": "point name"}}]}
pub fn parse_geojson(content: &str) -> Result<(String, Vec<RoutePoint>), ImportError> {
    tracing::debug!("parsing GeoJSON content");

    let geojson: GeoJson = content
        .parse()
        .map_err(|e| ImportError::InvalidGeoJson(format!("{}", e)))?;

    match geojson {
        GeoJson::Feature(feature) => parse_feature(feature),
        GeoJson::FeatureCollection(collection) => parse_feature_collection(collection),
        GeoJson::Geometry(_) => {
            tracing::warn!("received raw Geometry without Feature wrapper");
            Err(ImportError::MissingRouteName)
        }
    }
}

fn parse_feature(feature: Feature) -> Result<(String, Vec<RoutePoint>), ImportError> {
    tracing::debug!("parsing Feature");

    let name = extract_name_from_properties(&feature.properties)?;

    let geometry = feature
        .geometry
        .ok_or_else(|| ImportError::InvalidGeoJson("Feature has no geometry".to_string()))?;

    let points = parse_linestring_geometry(&geometry)?;

    if points.is_empty() {
        tracing::warn!("parsed LineString has no points");
        return Err(ImportError::EmptyRoute);
    }

    tracing::info!(
        route_name = %name,
        point_count = points.len(),
        "successfully parsed Feature with LineString"
    );

    Ok((name, points))
}

fn parse_feature_collection(
    collection: FeatureCollection,
) -> Result<(String, Vec<RoutePoint>), ImportError> {
    tracing::debug!(
        feature_count = collection.features.len(),
        "parsing FeatureCollection"
    );

    // Try to get name from FeatureCollection's foreign_members
    let name = collection
        .foreign_members
        .as_ref()
        .and_then(|fm| fm.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            tracing::warn!("FeatureCollection missing 'name' in foreign_members");
            ImportError::MissingRouteName
        })?;

    let mut points = Vec::new();

    for (idx, feature) in collection.features.into_iter().enumerate() {
        let geometry = match feature.geometry {
            Some(g) => g,
            None => {
                tracing::debug!(feature_idx = idx, "skipping feature without geometry");
                continue;
            }
        };

        match &geometry.value {
            Value::Point(coords) => {
                if coords.len() >= 2 {
                    let point_name = feature
                        .properties
                        .as_ref()
                        .and_then(|p| p.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let point = RoutePoint {
                        lng: coords[0],
                        lat: coords[1],
                        name: point_name,
                        segment_mode: None,
                        photo: None,
                    };

                    tracing::trace!(
                        feature_idx = idx,
                        lat = point.lat,
                        lng = point.lng,
                        point_name = ?point.name,
                        "parsed Point feature"
                    );

                    points.push(point);
                } else {
                    tracing::warn!(
                        feature_idx = idx,
                        coord_len = coords.len(),
                        "Point has insufficient coordinates"
                    );
                }
            }
            _ => {
                tracing::debug!(
                    feature_idx = idx,
                    "skipping non-Point geometry in FeatureCollection"
                );
            }
        }
    }

    if points.is_empty() {
        tracing::warn!("FeatureCollection has no valid Point features");
        return Err(ImportError::EmptyRoute);
    }

    tracing::info!(
        route_name = %name,
        point_count = points.len(),
        "successfully parsed FeatureCollection of Points"
    );

    Ok((name, points))
}

fn extract_name_from_properties(
    properties: &Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<String, ImportError> {
    properties
        .as_ref()
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            tracing::warn!("missing 'name' property in Feature");
            ImportError::MissingRouteName
        })
}

fn parse_linestring_geometry(geometry: &Geometry) -> Result<Vec<RoutePoint>, ImportError> {
    match &geometry.value {
        Value::LineString(coords) => {
            tracing::debug!(coord_count = coords.len(), "parsing LineString coordinates");

            let points: Vec<RoutePoint> = coords
                .iter()
                .enumerate()
                .filter_map(|(idx, coord)| {
                    if coord.len() >= 2 {
                        Some(RoutePoint {
                            lng: coord[0],
                            lat: coord[1],
                            name: None,
                            segment_mode: None,
                            photo: None,
                        })
                    } else {
                        tracing::warn!(
                            coord_idx = idx,
                            coord_len = coord.len(),
                            "skipping coordinate with insufficient dimensions"
                        );
                        None
                    }
                })
                .collect();

            Ok(points)
        }
        _ => {
            tracing::warn!("expected LineString geometry, got different type");
            Err(ImportError::UnsupportedGeometry)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_linestring_feature() {
        let geojson = r#"{
            "type": "Feature",
            "properties": {"name": "Test Route"},
            "geometry": {
                "type": "LineString",
                "coordinates": [[37.6173, 55.7558], [30.3351, 59.9343]]
            }
        }"#;

        let (name, points) = parse_geojson(geojson).unwrap();

        assert_eq!(name, "Test Route");
        assert_eq!(points.len(), 2);
        assert_eq!(points[0].lng, 37.6173);
        assert_eq!(points[0].lat, 55.7558);
        assert_eq!(points[1].lng, 30.3351);
        assert_eq!(points[1].lat, 59.9343);
    }

    #[test]
    fn test_parse_feature_collection_of_points() {
        let geojson = r#"{
            "type": "FeatureCollection",
            "name": "My Route",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"name": "Moscow"},
                    "geometry": {"type": "Point", "coordinates": [37.6173, 55.7558]}
                },
                {
                    "type": "Feature",
                    "properties": {"name": "Saint Petersburg"},
                    "geometry": {"type": "Point", "coordinates": [30.3351, 59.9343]}
                }
            ]
        }"#;

        let (name, points) = parse_geojson(geojson).unwrap();

        assert_eq!(name, "My Route");
        assert_eq!(points.len(), 2);
        assert_eq!(points[0].name, Some("Moscow".to_string()));
        assert_eq!(points[0].lng, 37.6173);
        assert_eq!(points[0].lat, 55.7558);
        assert_eq!(points[1].name, Some("Saint Petersburg".to_string()));
    }

    #[test]
    fn test_missing_name_returns_error() {
        let geojson = r#"{
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "LineString",
                "coordinates": [[37.6173, 55.7558]]
            }
        }"#;

        let result = parse_geojson(geojson);
        assert!(matches!(result, Err(ImportError::MissingRouteName)));
    }

    #[test]
    fn test_empty_coordinates_returns_error() {
        let geojson = r#"{
            "type": "Feature",
            "properties": {"name": "Empty Route"},
            "geometry": {
                "type": "LineString",
                "coordinates": []
            }
        }"#;

        let result = parse_geojson(geojson);
        assert!(matches!(result, Err(ImportError::EmptyRoute)));
    }

    #[test]
    fn test_unsupported_geometry_returns_error() {
        let geojson = r#"{
            "type": "Feature",
            "properties": {"name": "Polygon Route"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
            }
        }"#;

        let result = parse_geojson(geojson);
        assert!(matches!(result, Err(ImportError::UnsupportedGeometry)));
    }

    #[test]
    fn test_invalid_json_returns_error() {
        let geojson = "not valid json";

        let result = parse_geojson(geojson);
        assert!(matches!(result, Err(ImportError::InvalidGeoJson(_))));
    }
}
