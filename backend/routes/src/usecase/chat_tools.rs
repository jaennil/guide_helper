use std::collections::HashMap;

use serde_json::Value;

use crate::usecase::ai_client::AiTool;

use super::{ChatAction, ChatPoint, ChatRouteRef};

pub(super) fn build_tools() -> Vec<AiTool> {
    vec![
        AiTool {
            name: "geocode".to_string(),
            description: "Geocode a place name or address to get its latitude and longitude. Calling this tool places a marker for the location on the interactive map. Call it once per location when building routes or showing places.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The place name or address to geocode"
                    }
                },
                "required": ["query"]
            }),
        },
        AiTool {
            name: "search_routes".to_string(),
            description: "Search the route catalog for shared routes. Can filter by text query, category UUID, and sort order.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Text search query for route names"
                    },
                    "category_id": {
                        "type": "string",
                        "description": "Filter by category UUID"
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["newest", "oldest", "popular", "top_rated"],
                        "description": "Sort order for results"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results (1-10)"
                    }
                },
                "required": []
            }),
        },
        AiTool {
            name: "get_route_details".to_string(),
            description: "Get detailed information about a specific route by its ID.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "route_id": {
                        "type": "string",
                        "description": "The UUID of the route"
                    }
                },
                "required": ["route_id"]
            }),
        },
        AiTool {
            name: "navigate".to_string(),
            description: "Navigate to a specific page in the application. Use when the user asks to open, go to, or navigate to a page.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "enum": ["/map", "/profile", "/explore", "/admin"],
                        "description": "Page path: /map (main map), /profile (profile & settings), /explore (route catalog), /admin (admin panel)"
                    }
                },
                "required": ["path"]
            }),
        },
    ]
}

pub(super) fn parse_function_arguments(input: &str) -> HashMap<String, Value> {
    match serde_json::from_str::<Value>(input) {
        Ok(Value::Object(map)) => map.into_iter().collect(),
        Ok(_) => {
            tracing::warn!(raw = %input, "function arguments are not an object");
            HashMap::new()
        }
        Err(e) => {
            tracing::warn!(error = %e, raw = %input, "failed to parse function arguments");
            HashMap::new()
        }
    }
}

pub(super) fn is_supported_tool(name: &str) -> bool {
    matches!(
        name,
        "geocode" | "search_routes" | "get_route_details" | "navigate"
    )
}

pub(super) fn collect_points_from_actions(actions: &[ChatAction]) -> Vec<ChatPoint> {
    let mut points: Vec<ChatPoint> = Vec::new();

    for action in actions {
        if let ChatAction::ShowPoints {
            points: action_points,
        } = action
        {
            for point in action_points {
                let is_duplicate = points.iter().any(|existing| {
                    existing.name == point.name
                        && (existing.lat - point.lat).abs() < f64::EPSILON
                        && (existing.lng - point.lng).abs() < f64::EPSILON
                });

                if !is_duplicate {
                    points.push(point.clone());
                }
            }
        }
    }

    points
}

pub(super) fn normalize_actions(actions: Vec<ChatAction>) -> Vec<ChatAction> {
    let mut normalized = Vec::new();

    let points = collect_points_from_actions(&actions);
    if !points.is_empty() {
        normalized.push(ChatAction::ShowPoints { points });
    }

    let mut routes: Vec<ChatRouteRef> = Vec::new();
    for action in &actions {
        if let ChatAction::ShowRoutes {
            routes: action_routes,
        } = action
        {
            for route in action_routes {
                let is_duplicate = routes.iter().any(|existing| existing.id == route.id);
                if !is_duplicate {
                    routes.push(route.clone());
                }
            }
        }
    }

    if !routes.is_empty() {
        normalized.push(ChatAction::ShowRoutes { routes });
    }

    normalized.extend(actions.into_iter().filter_map(|action| match action {
        ChatAction::Navigate { path, label } => Some(ChatAction::Navigate { path, label }),
        _ => None,
    }));

    normalized
}
