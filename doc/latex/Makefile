MAIN = main
ENGINE = xelatex

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

.PHONY: all quick clean distclean
