MAIN = main
DOCKER_IMAGE ?= guide-helper-latex
HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)
DOCKER_RUN = docker run --rm --user "$(HOST_UID):$(HOST_GID)" -e HOME=/tmp -e XDG_CACHE_HOME=/tmp/.cache -v "$(PWD):/work" -w /work $(DOCKER_IMAGE)

all: docker

docker-build:
	docker build -t $(DOCKER_IMAGE) .

docker:
	$(DOCKER_RUN) latexmk -xelatex -interaction=nonstopmode -halt-on-error $(MAIN).tex

clean: docker-build
	$(DOCKER_RUN) latexmk -c
	rm -f *.bbl *.run.xml

distclean: docker-build
	$(DOCKER_RUN) latexmk -C
	rm -f *.bbl *.run.xml

clean-local-artifacts:
	rm -f *.aux *.bbl *.bcf *.blg *.fdb_latexmk *.fls *.log *.out *.run.xml *.toc *.xdv *.pdf

verify-fonts:
	pdffonts $(MAIN).pdf | grep -E 'Times|TimesNewRoman'

local:
	@echo "Local LaTeX build is disabled. Use 'make docker-build && make docker' to guarantee Times New Roman." >&2
	@exit 1

quick: local

$(MAIN).pdf: docker

.PHONY: all docker-build docker clean distclean clean-local-artifacts verify-fonts local quick
