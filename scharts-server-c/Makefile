CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -pedantic -std=c89
LDFLAGS ?=
LDLIBS ?= -lm

TARGET = scharts-server
SOURCES = server.c

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(SOURCES)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $(SOURCES) $(LDLIBS)

clean:
	rm -f $(TARGET)
