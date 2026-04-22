# Guide Helper Demo Voiceover

## 0:00-0:08
Guide Helper is an information system for creating and publishing tourist routes with geotagged photographs, interactive sharing, and route analytics.

## 0:08-0:38
The core problem is that routes, photos, comments, and contextual data are usually stored in different tools. The guide has to assemble the final route manually and then explain it again in messengers or documents.

## 0:38-1:14
In the route editor, the guide places points on the map and gets an automatically built route. The system calculates distance, elevation gain, estimated travel time, and weather context. Photos can be attached to points, and the route is prepared for publication directly in the same interface.

## 1:14-1:46
After publication, the route can be opened by link without deep onboarding. The tourist sees the map, point markers, comments, ratings, and route statistics. This allows the guide to share not just a track, but a route with visual context.

## 1:46-2:02
The public catalog supports search and filtering by category, season, freshness, and popularity. This makes it possible to use the system not only for personal sharing, but also as a content platform.

## 2:02-2:20
In the profile section, the author manages saved routes, shares them, and exports data to GPX or KML. This is important for practical use and interoperability with other mapping tools.

## 2:20-2:48
The system architecture is based on microservices. The frontend works with route, photo, and authentication services. External providers are used for map tiles, geocoding, elevation, and weather. This decomposition isolates responsibilities and simplifies scaling.

## 2:48-2:58
As a result, Guide Helper covers the full route lifecycle: creation, enrichment with media, publication, discovery, and repeated use.
