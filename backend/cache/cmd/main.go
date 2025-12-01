package main

import (
	"log"

	"github.com/jaennil/guide_helper/backend/cache/internal/app"
	"github.com/jaennil/guide_helper/backend/cache/pkg/config"
)

func main() {
	realMain()
}

func realMain() {
	cfg, err := config.New()
	if err != nil {
		log.Fatalln("failed to load config: ", err)
	}

	app.Run(cfg)
}
