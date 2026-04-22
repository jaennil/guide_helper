use super::DirectRouteRequest;

pub(super) fn contains_cyrillic(text: &str) -> bool {
    text.chars()
        .any(|ch| ('\u{0400}'..='\u{04FF}').contains(&ch))
}

pub(super) fn is_ambiguous_place_query(query: &str) -> bool {
    let normalized_query = normalize_whitespace(query);
    if normalized_query.is_empty() || normalized_query.contains(',') {
        return false;
    }

    let query_word_count = normalized_query.split_whitespace().count();
    let query_has_digits = normalized_query.chars().any(|ch| ch.is_ascii_digit());
    !query_has_digits && query_word_count <= 4
}

pub(super) fn extract_route_locations(text: &str) -> Option<Vec<String>> {
    extract_direct_route_request(text).map(|request| request.display_places)
}

pub(super) fn extract_direct_route_request(text: &str) -> Option<DirectRouteRequest> {
    let normalized = format!(" {} ", normalize_whitespace(text).to_lowercase());
    let patterns = [
        (" от ", " до "),
        (" из ", " до "),
        (" из ", " в "),
        (" from ", " to "),
    ];

    for (from_token, to_token) in patterns {
        let Some(from_idx) = normalized.find(from_token) else {
            continue;
        };

        let after_from = &normalized[from_idx + from_token.len()..];
        let Some(to_idx) = after_from.rfind(to_token) else {
            continue;
        };

        let start_and_waypoints = trim_place_name(&after_from[..to_idx]);
        let end = trim_place_name(&after_from[to_idx + to_token.len()..]);

        if start_and_waypoints.is_empty() || end.is_empty() {
            continue;
        }

        let mut display_places = split_place_list(&start_and_waypoints);
        display_places.push(end);
        display_places.retain(|place| !place.is_empty());

        if display_places.len() >= 2 {
            let context = extract_route_context(&normalized[..from_idx]);
            let geocoding_queries = display_places
                .iter()
                .map(|place| enrich_place_with_context(place, context.as_deref()))
                .collect();

            return Some(DirectRouteRequest {
                display_places,
                geocoding_queries,
            });
        }
    }

    None
}

pub(super) fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn summarize_user_message(text: &str) -> String {
    let normalized = normalize_whitespace(text);
    let mut chars = normalized.chars();
    let summary: String = chars.by_ref().take(160).collect();
    if chars.next().is_some() {
        format!("{}...", summary)
    } else {
        summary
    }
}

fn extract_route_context(prefix: &str) -> Option<String> {
    let trimmed = prefix.trim();
    for token in [" в ", " in "] {
        if let Some(idx) = trimmed.rfind(token) {
            let context = trim_place_name(&trimmed[idx + token.len()..]);
            if !context.is_empty() {
                return Some(context);
            }
        }
    }
    None
}

fn enrich_place_with_context(place: &str, context: Option<&str>) -> String {
    let Some(context) = context.map(str::trim).filter(|value| !value.is_empty()) else {
        return place.to_string();
    };

    let place_lower = place.to_lowercase();
    let context_lower = context.to_lowercase();
    if place_lower.contains(&context_lower) {
        place.to_string()
    } else {
        format!("{}, {}", place, context)
    }
}

fn split_place_list(input: &str) -> Vec<String> {
    input
        .replace(" через ", ",")
        .replace(" via ", ",")
        .replace(" и ", ",")
        .replace(" and ", ",")
        .split(',')
        .map(trim_place_name)
        .filter(|value| !value.is_empty())
        .collect()
}

fn trim_place_name(input: &str) -> String {
    input
        .trim_matches(|c: char| {
            c.is_whitespace()
                || matches!(
                    c,
                    ',' | '.' | '!' | '?' | ':' | ';' | '"' | '\'' | '(' | ')' | '[' | ']'
                )
        })
        .to_string()
}
