use crate::domain::chat_message::ChatMessage;

use super::direct::{extract_direct_route_request, is_ambiguous_place_query, normalize_whitespace};
use super::tools::collect_points_from_actions;
use super::{ChatAction, ChatMapContext, ChatMapPointContext};

pub(super) const SYSTEM_PROMPT: &str = r#"You are a helpful route planning assistant for the Guide Helper application.
You help users find routes, plan trips, search the route catalog, and answer questions about places.
Always respond in the same language the user writes in.

You have access to these tools:
- geocode: Look up coordinates for any place name or address. Calling this tool automatically displays the location as a marker on the interactive map.
- search_routes: Search the route catalog for shared routes by text query, category, or sort order.
- get_route_details: Get detailed information about a specific route by its ID.
- navigate: Open a specific page in the application (map, profile/settings, route catalog, admin panel).

Rules for tool usage — follow these strictly:
1. When the user asks to SHOW, FIND, MARK, or DISPLAY a location — call geocode for that location.
2. When the user asks to BUILD A ROUTE, PLAN A TRIP, or GO FROM one place TO another — call geocode for each MISSING location needed to build the route, then describe the route between them. If the current map context already contains route points, treat those existing points as already known route endpoints and geocode only the new destination(s). Do NOT give text-only directions; always geocode the places first.
3. When the user asks to search or browse routes in the catalog — use search_routes.
4. When the user mentions a specific route ID — use get_route_details.
5. NEVER say you cannot display maps or show locations on the map. You CAN show locations by calling the geocode tool — it will place markers on the map automatically.
6. If the user names two or more places, call geocode separately for each one.
7. When the user says anything that means OPENING or NAVIGATING to a section of this app — ALWAYS call navigate immediately without asking for clarification. Do not ask "what do you want to configure" — just navigate.
8. For any place or address lookup, geocode.query MUST contain the place or address text from the user's message. Never send an empty query. If the user asks a follow-up question and the current map context already contains a relevant city or route point, you should enrich an ambiguous landmark query with that context, for example "кремль, Москва" or "Московский Кремль".
9. You may ONLY use these tools: geocode, search_routes, get_route_details, navigate. Never call WebSearch, ToolSearch, Bash, Read, Write, or any other tools.

Page mapping (use navigate tool with these paths):
- /profile → when user says: "открой профиль", "профиль", "настройки", "открой настройки", "open settings", "go to profile", "мои настройки", "мой профиль", "settings", "profile"
- /map → when user says: "открой карту", "перейди на карту", "на карту", "go to map", "open map", "карта"
- /explore → when user says: "открой каталог", "каталог маршрутов", "explore", "посмотреть маршруты", "open catalog", "route catalog"
- /admin → when user says: "открой админку", "панель администратора", "admin", "admin panel", "администрирование"

CRITICAL: For ALL navigation requests, call navigate IMMEDIATELY. Never ask clarifying questions about navigation. If the user wants to open any page or section, use the navigate tool.

Examples:
- User: "найди бутлерова 2к2" → call geocode with {"query":"бутлерова 2к2"}
- User: "где москва-сити" → call geocode with {"query":"москва-сити"}
- User: "build a route from Rome to Milan" → call geocode with {"query":"Rome"} and geocode with {"query":"Milan"}
- If the current map already has a point in Moscow and the user says "построй маршрут до кремля" → geocode the new destination with a context-aware query such as {"query":"кремль, Москва"}

Be concise and helpful. After calling tools, summarize the results naturally."#;

pub(super) fn map_context_from_history(history: &[ChatMessage]) -> Option<ChatMapContext> {
    history.iter().rev().find_map(|message| {
        let actions = message.actions.clone()?;
        let parsed_actions = serde_json::from_value::<Vec<ChatAction>>(actions).ok()?;
        let points = collect_points_from_actions(&parsed_actions);
        if points.is_empty() {
            return None;
        }

        Some(ChatMapContext {
            points: points
                .into_iter()
                .map(|point| ChatMapPointContext {
                    lat: point.lat,
                    lng: point.lng,
                    name: Some(point.name),
                })
                .collect(),
        })
    })
}

pub(super) fn merge_map_contexts(
    preferred: Option<ChatMapContext>,
    fallback: Option<ChatMapContext>,
) -> Option<ChatMapContext> {
    preferred
        .filter(|context| !context.points.is_empty())
        .or_else(|| fallback.filter(|context| !context.points.is_empty()))
}

pub(super) fn build_system_prompt(map_context: Option<&ChatMapContext>) -> String {
    let Some(context) = map_context.filter(|context| !context.points.is_empty()) else {
        return SYSTEM_PROMPT.to_string();
    };

    let point_lines = context
        .points
        .iter()
        .rev()
        .take(4)
        .enumerate()
        .map(|(index, point)| {
            let label = point
                .name
                .clone()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| format!("{:.6}, {:.6}", point.lat, point.lng));
            format!(
                "{}. {} ({:.6}, {:.6})",
                index + 1,
                label,
                point.lat,
                point.lng
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "{SYSTEM_PROMPT}\n\nCurrent map context for this request:\n- There are already {} point(s) on the map.\n- Most recent map points:\n{}\nUse this context when the user asks a follow-up route question. If they ask to build a route to or from one new place, treat the existing map point(s) as the other route endpoint(s). When a landmark query is ambiguous, prefer the candidate nearest to the existing map points.",
        context.points.len(),
        point_lines
    )
}

pub(super) fn most_recent_map_point(map_context: &ChatMapContext) -> Option<&ChatMapPointContext> {
    map_context.points.last()
}

pub(super) fn should_bias_geocode_to_existing_route(
    latest_user_message: &str,
    query: &str,
) -> bool {
    if query.trim().is_empty() || extract_direct_route_request(latest_user_message).is_some() {
        return false;
    }

    let normalized_message = format!(
        " {} ",
        normalize_whitespace(latest_user_message).to_lowercase()
    );
    let has_route_intent = [
        " маршрут ",
        " route ",
        " добраться ",
        " доехать ",
        " проложи ",
        " построи ",
        " построить ",
        " путь ",
    ]
    .iter()
    .any(|token| normalized_message.contains(token));

    if !has_route_intent {
        return false;
    }

    let has_partial_endpoint = [" до ", " to ", " к ", " from ", " от ", " из "]
        .iter()
        .any(|token| normalized_message.contains(token));

    if !has_partial_endpoint {
        return false;
    }

    is_ambiguous_place_query(query)
}

pub(super) fn distance_squared(from_lat: f64, from_lng: f64, to_lat: f64, to_lng: f64) -> f64 {
    let lat_delta = from_lat - to_lat;
    let lng_delta = from_lng - to_lng;
    lat_delta * lat_delta + lng_delta * lng_delta
}
