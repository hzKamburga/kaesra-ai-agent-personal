#!/usr/bin/env python3
import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()


@dataclass
class Issue:
    path: str
    kind: str
    detail: str


def is_invalid_number(value: Any) -> bool:
    return isinstance(value, float) and (math.isnan(value) or math.isinf(value))


def analyze_value(value: Any, path: str, issues: List[Issue]) -> Any:
    if isinstance(value, dict):
        fixed = {}
        for key, item in value.items():
            child_path = f"{path}.{key}" if path else key
            fixed[key] = analyze_value(item, child_path, issues)
        return fixed

    if isinstance(value, list):
        fixed = []
        for index, item in enumerate(value):
            child_path = f"{path}[{index}]"
            fixed.append(analyze_value(item, child_path, issues))

        if value:
            element_types = {type(item).__name__ for item in value}
            if len(element_types) > 1:
                issues.append(
                    Issue(path=path, kind="mixed_list_types", detail=f"Types: {sorted(element_types)}")
                )

        return fixed

    if value is None:
        issues.append(Issue(path=path, kind="null", detail="Null value found"))
        return ""

    if isinstance(value, str) and value.strip() == "":
        issues.append(Issue(path=path, kind="empty_string", detail="Empty string found"))
        return value

    if is_invalid_number(value):
        issues.append(Issue(path=path, kind="invalid_number", detail=f"Invalid float: {value}"))
        return None

    return value


def analyze_json(input_path: Path, apply_fix: bool) -> Tuple[Dict[str, Any], List[Issue]]:
    raw = input_path.read_text(encoding="utf-8")
    data = json.loads(raw)

    issues: List[Issue] = []
    fixed_data = analyze_value(data, "root", issues)

    result_data = fixed_data if apply_fix else data
    return result_data, issues


def render_report(issues: List[Issue]) -> None:
    if not issues:
        console.print(Panel("No issues found.", title="Data Analyzer", border_style="green"))
        return

    table = Table(title="Data Quality Report")
    table.add_column("#", style="cyan", no_wrap=True)
    table.add_column("Path", style="magenta")
    table.add_column("Kind", style="yellow")
    table.add_column("Detail", style="white")

    for idx, issue in enumerate(issues, start=1):
        table.add_row(str(idx), issue.path, issue.kind, issue.detail)

    console.print(table)
    console.print(Panel(f"Total issues: {len(issues)}", border_style="red"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def create_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    console.print(Panel(f"Created file: {path}", border_style="green"))


def run_tui() -> None:
    try:
        from textual.app import App, ComposeResult
        from textual.widgets import Footer, Header, Static
    except Exception:
        console.print(
            Panel(
                "TUI dependencies are missing. Run: pip install textual rich",
                title="TUI Unavailable",
                border_style="red"
            )
        )
        return

    class AnalyzerTUI(App):
        TITLE = "{{PROJECT_NAME}}"

        def compose(self) -> ComposeResult:
            yield Header(show_clock=True)
            yield Static(
                "Use CLI commands for now:\n"
                "- analyze <file> [--fix --output file]\n"
                "- new-file <path> --content '{}',\n"
                "This TUI shell is ready for expansion.",
                classes="content"
            )
            yield Footer()

    AnalyzerTUI().run()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="{{PROJECT_NAME}}")
    sub = parser.add_subparsers(dest="command", required=True)

    analyze = sub.add_parser("analyze", help="Analyze JSON file")
    analyze.add_argument("input", help="Input JSON path")
    analyze.add_argument("--fix", action="store_true", help="Apply auto-fixes")
    analyze.add_argument("--output", help="Output JSON path for fixed data")

    create = sub.add_parser("new-file", help="Create a file with content")
    create.add_argument("path", help="Target file path")
    create.add_argument("--content", default="", help="File content")

    sub.add_parser("tui", help="Launch interactive TUI shell")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "analyze":
        input_path = Path(args.input)
        if not input_path.exists():
            console.print(Panel(f"File not found: {input_path}", border_style="red"))
            raise SystemExit(1)

        try:
            result_data, issues = analyze_json(input_path, apply_fix=args.fix)
        except json.JSONDecodeError as exc:
            console.print(Panel(f"Invalid JSON: {exc}", border_style="red"))
            raise SystemExit(1)

        render_report(issues)

        if args.fix:
            output_path = Path(args.output) if args.output else input_path.with_name(f"{input_path.stem}.fixed.json")
            write_json(output_path, result_data)
            console.print(Panel(f"Fixed JSON written: {output_path}", border_style="green"))

        return

    if args.command == "new-file":
        create_file(Path(args.path), args.content)
        return

    if args.command == "tui":
        run_tui()
        return


if __name__ == "__main__":
    main()
