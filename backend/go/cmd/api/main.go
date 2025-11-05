package main

import (
	"backend/pkg/config"
	"log"
)

func main() {
	realMain()
}

func realMain() {
	cfg, err := config.New()
	if err != nil {
		log.Fatal("failed to load config: %w", err)
	}

	app.Run(cfg)
}
