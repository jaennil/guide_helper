package telemetry

import (
	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

const (
	tracerName = "github.com/jaennil/guide_helper/backend/tiles"
)

// GinMiddleware returns a Gin middleware that creates spans for each HTTP request
func GinMiddleware(serviceName string) gin.HandlerFunc {
	tracer := otel.Tracer(tracerName)

	return func(c *gin.Context) {
		// Skip tracing for health checks and metrics endpoints
		if c.Request.URL.Path == "/healthz" || c.Request.URL.Path == "/metrics" {
			c.Next()
			return
		}

		// Extract context from headers (for distributed tracing)
		ctx := otel.GetTextMapPropagator().Extract(c.Request.Context(), propagation.HeaderCarrier(c.Request.Header))

		// Create span
		spanName := c.Request.Method + " " + c.FullPath()
		ctx, span := tracer.Start(ctx, spanName,
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(
				semconv.HTTPRequestMethodKey.String(c.Request.Method),
				semconv.URLPath(c.Request.URL.Path),
				semconv.HTTPRoute(c.FullPath()),
				semconv.URLScheme(c.Request.URL.Scheme),
				semconv.ServerAddress(c.Request.Host),
				semconv.UserAgentOriginal(c.Request.UserAgent()),
				semconv.ClientAddress(c.ClientIP()),
			),
		)
		defer span.End()

		// Store span in context for handlers to use
		c.Request = c.Request.WithContext(ctx)

		// Inject trace context into response headers (for distributed tracing)
		otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(c.Writer.Header()))

		// Process request
		c.Next()

		// Set span status based on response
		statusCode := c.Writer.Status()
		span.SetAttributes(
			semconv.HTTPResponseStatusCode(statusCode),
			attribute.Int("http.response.size", c.Writer.Size()),
		)

		if statusCode >= 400 {
			span.SetStatus(codes.Error, c.Errors.String())
			if len(c.Errors) > 0 {
				span.RecordError(c.Errors.Last())
			}
		} else {
			span.SetStatus(codes.Ok, "")
		}
	}
}

// SpanFromContext retrieves the current span from gin context
func SpanFromContext(c *gin.Context) trace.Span {
	return trace.SpanFromContext(c.Request.Context())
}

// TracerFromContext retrieves the tracer
func TracerFromContext(c *gin.Context) trace.Tracer {
	return otel.Tracer(tracerName)
}
