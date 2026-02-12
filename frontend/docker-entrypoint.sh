#!/bin/sh
set -e

# Extract DNS nameserver from /etc/resolv.conf for nginx runtime resolution.
# Docker uses 127.0.0.11, Kubernetes uses kube-dns (e.g. 10.96.0.10).
export NAMESERVER=$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)
echo "Using DNS resolver: $NAMESERVER"

# Substitute env vars in nginx config template
envsubst '${NAMESERVER}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
