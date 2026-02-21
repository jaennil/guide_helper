use std::time::Duration;

use reqwest::Client;
use serde::Deserialize;

#[derive(Deserialize, Default)]
struct NominatimAddress {
    road: Option<String>,
    suburb: Option<String>,
    neighbourhood: Option<String>,
    village: Option<String>,
    town: Option<String>,
    city: Option<String>,
}

#[derive(Deserialize)]
struct NominatimResponse {
    address: Option<NominatimAddress>,
    display_name: Option<String>,
}

#[derive(Clone)]
pub struct NominatimClient {
    client: Client,
    base_url: String,
}

impl NominatimClient {
    pub fn new(base_url: String) -> Self {
        let client = Client::builder()
            .user_agent("GuideHelper/1.0")
            .timeout(Duration::from_secs(10))
            .build()
            .expect("failed to build nominatim http client");
        Self { client, base_url }
    }

    async fn reverse_geocode_at_zoom(&self, lat: f64, lng: f64, zoom: u8) -> String {
        let url = format!(
            "{}/reverse?lat={}&lon={}&format=json&accept-language=ru&zoom={}",
            self.base_url, lat, lng, zoom
        );

        let resp = match self.client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(error = %e, lat, lng, zoom, "nominatim request failed");
                return String::new();
            }
        };

        let data: NominatimResponse = match resp.json().await {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(error = %e, "nominatim response parse failed");
                return String::new();
            }
        };

        let addr = data.address.unwrap_or_default();
        let name = if zoom >= 16 {
            addr.road
                .or(addr.suburb)
                .or(addr.neighbourhood)
                .or(addr.city)
        } else {
            addr.suburb
                .or(addr.neighbourhood)
                .or(addr.village)
                .or(addr.town)
                .or(addr.city)
        };

        name.or_else(|| {
            data.display_name
                .map(|s| s.split(',').next().unwrap_or("").trim().to_string())
        })
        .unwrap_or_default()
    }

    /// Resolves human-readable location names for the start and end of a route.
    /// Tries progressively more specific zoom levels until names differ.
    pub async fn resolve_route_locations(
        &self,
        first: (f64, f64),
        last: (f64, f64),
    ) -> (String, String) {
        let coords_match =
            (first.0 - last.0).abs() < 1e-9 && (first.1 - last.1).abs() < 1e-9;

        for zoom in [14u8, 16, 18] {
            let from = self.reverse_geocode_at_zoom(first.0, first.1, zoom).await;
            tokio::time::sleep(Duration::from_millis(1100)).await;

            let to = if coords_match {
                from.clone()
            } else {
                let t = self.reverse_geocode_at_zoom(last.0, last.1, zoom).await;
                tokio::time::sleep(Duration::from_millis(1100)).await;
                t
            };

            if from != to || coords_match {
                tracing::debug!(zoom, %from, %to, "resolved route locations");
                return (from, to);
            }

            tracing::debug!(zoom, %from, "locations matched, trying higher zoom");
        }

        (String::new(), String::new())
    }
}
