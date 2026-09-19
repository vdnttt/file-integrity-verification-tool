CXX ?= g++
CXXFLAGS ?= -std=c++20 -O2 -Wall -Wextra -pedantic

all: cpp/integrity_engine

cpp/integrity_engine: cpp/integrity_engine.cpp
	$(CXX) $(CXXFLAGS) $< -o $@

run: cpp/integrity_engine
	python3 run.py

clean:
	rm -f cpp/integrity_engine cpp/integrity_engine.exe backend/integrity.db
