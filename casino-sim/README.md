# casino-sim

Python-based casino simulation with slot machine, roulette, and blackjack mini-games, CLI interface, and persistent user balance via JSON.

## Features

- JSON analysis with detailed issue report
- Optional auto-fix for common data issues
- File creation utility from CLI
- Optional TUI mode for interactive usage (`textual`)

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -e .
```

## Usage

```bash
python main.py analyze sample.json
python main.py analyze sample.json --fix --output fixed.json
python main.py new-file reports/output.json --content "{}"
python main.py tui
```
