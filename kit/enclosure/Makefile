# The Hindsight kit enclosure. See SPEC.md, REPORT.md and PRINTING.md.
#
#   make setup    create .venv and install build123d and friends (once)
#   make          rebuild: STEP/STL into out/, PNGs into renders/, REPORT.md
#   make report   the same without the renders (faster)
#   make test     check the printability analysis against shapes that should fail
#
# After a caliper measurement: edit the one parameter in kit.py, then `make`.

PY := .venv/bin/python

.PHONY: all report test setup

all: $(PY)
	$(PY) kit.py

report: $(PY)
	$(PY) kit.py --no-render

test: $(PY)
	$(PY) tests.py

setup: $(PY)

$(PY):
	python3.12 -m venv .venv
	$(PY) -m pip install -q --upgrade pip
	$(PY) -m pip install -q -r requirements.txt
