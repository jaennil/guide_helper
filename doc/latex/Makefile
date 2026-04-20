MAIN = main
ENGINE = xelatex
DOCKER_IMAGE ?= guide-helper-latex

all: $(MAIN).pdf

$(MAIN).pdf: $(MAIN).tex preamble.tex titlepage.tex chapters/*.tex references.bib
	latexmk -$(ENGINE) -interaction=nonstopmode -halt-on-error $(MAIN).tex

quick:
	$(ENGINE) -interaction=nonstopmode $(MAIN).tex

clean:
	latexmk -c
	rm -f *.bbl *.run.xml

distclean:
	latexmk -C
	rm -f *.bbl *.run.xml

docker-build:
	docker build -t $(DOCKER_IMAGE) .

docker:
	docker run --rm -v "$(PWD):/work" -w /work $(DOCKER_IMAGE) make

.PHONY: all quick clean distclean docker-build docker
