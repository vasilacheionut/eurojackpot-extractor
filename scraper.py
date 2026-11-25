import argparse
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "https://www.eurojackpot.com/"
YEARS_DATES_FILE = Path("years-dates.json")
DRAWS_FILE = Path("draws.json")


def parse_dmy_to_num(date_str: str) -> int:
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})$", str(date_str or "").strip())
    if not m:
        return 0
    return int(f"{m.group(3)}{m.group(2)}{m.group(1)}")


def infer_year(date_str: str, fallback_year: int | None = None) -> int | None:
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})$", str(date_str or "").strip())
    if m:
        return int(m.group(3))
    return int(fallback_year) if fallback_year else None


def is_valid_draw(d: dict) -> bool:
    if not d or not re.match(r"^\d{2}\.\d{2}\.\d{4}$", str(d.get("date", ""))):
        return False
    year = infer_year(d.get("date"), d.get("year"))
    if not year:
        return False

    main_nums = d.get("mainNumbers")
    euro_nums = d.get("euroNumbers")
    if not isinstance(main_nums, list) or len(main_nums) != 5:
        return False
    if not isinstance(euro_nums, list) or len(euro_nums) != 2:
        return False

    if len(set(main_nums)) != 5 or any(
        not isinstance(n, int) or isinstance(n, bool) or n < 1 or n > 50 for n in main_nums
    ):
        return False
    if len(set(euro_nums)) != 2 or any(
        not isinstance(n, int) or isinstance(n, bool) or n < 1 or n > 12 for n in euro_nums
    ):
        return False

    return True


def load_years_dates() -> dict[int, set[str]]:
    data: dict[int, set[str]] = {}
    if YEARS_DATES_FILE.exists():
        raw = json.loads(YEARS_DATES_FILE.read_text(encoding="utf-8"))
        for item in raw.get("years", []):
            if isinstance(item, dict) and item.get("year") and isinstance(item.get("dates"), list):
                data[int(item["year"])] = set(str(x).strip() for x in item["dates"] if str(x).strip())
    return data


def save_years_dates(data: dict[int, set[str]]) -> None:
    years_list = [
        {"year": yr, "dates": sorted(data[yr], key=parse_dmy_to_num)}
        for yr in sorted(data.keys())
    ]
    YEARS_DATES_FILE.write_text(
        json.dumps({"years": years_list}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def load_draws() -> dict[str, dict]:
    draws_map: dict[str, dict] = {}
    if DRAWS_FILE.exists():
        try:
            raw = json.loads(DRAWS_FILE.read_text(encoding="utf-8"))
            for item in raw.get("draws", []):
                if is_valid_draw(item):
                    dt = item["date"]
                    draws_map[dt] = {
                        "year": infer_year(dt, item.get("year")),
                        "date": dt,
                        "mainNumbers": item["mainNumbers"],
                        "euroNumbers": item["euroNumbers"],
                    }
        except Exception as exc:
            print(f"Warning reading draws.json: {exc}")
    return draws_map


def save_draws(draws_map: dict[str, dict]) -> int:
    ordered = sorted(draws_map.values(), key=lambda x: parse_dmy_to_num(x["date"]), reverse=True)
    DRAWS_FILE.write_text(
        json.dumps({"draws": ordered}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return len(ordered)


def parse_years_filter(range_str: str, available_years_desc: list[int]) -> list[int]:
    raw = str(range_str or "").strip()
    if not raw:
        return available_years_desc

    selected: set[int] = set()
    for part in [p.strip() for p in raw.split(",") if p.strip()]:
        m_range = re.match(r"^(\d{4})\s*-\s*(\d{4})$", part)
        if m_range:
            a, b = int(m_range.group(1)), int(m_range.group(2))
            for y in range(max(a, b), min(a, b) - 1, -1):
                selected.add(y)
        elif re.match(r"^\d{4}$", part):
            selected.add(int(part))

    return sorted(selected, reverse=True)


def select_option_by_text(page, selector: str, target_text: str) -> bool:
    locator = page.locator(selector).first
    info = locator.evaluate(
        """(el, txt) => {
            const idx = Array.from(el.options).findIndex((o) => {
                const t = (o.textContent || "").trim();
                const v = (o.value || "").trim();
                return t === txt || t.includes(txt) || v === txt || v.includes(txt);
            });
            if (idx === -1) return null;
            return { index: idx, value: el.options[idx].value };
        }""",
        target_text,
    )
    if not info:
        return False

    try:
        locator.select_option(index=info["index"], timeout=5000)
    except Exception:
        pass

    locator.evaluate(
        """(el, idx) => {
            el.selectedIndex = idx;
            if (el.options[idx]) el.value = el.options[idx].value;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        }""",
        info["index"],
    )
    return True


def read_winning_numbers(page) -> dict:
    return page.evaluate(
        """() => {
            const host = document.querySelector("app-winning-numbers") || document.body;
            const els = Array.from(host.querySelectorAll(".winning-number"));
            const nums = els
                .map((el) => Number((el.textContent || "").trim()))
                .filter((n) => Number.isInteger(n));
            return {
                mainNumbers: nums.slice(0, 5),
                euroNumbers: nums.slice(5, 7)
            };
        }"""
    )


def get_selected_date_label(page) -> str:
    try:
        return page.locator('select[formcontrolname="datum"]').evaluate(
            """(el) => {
                const opt = el.selectedOptions && el.selectedOptions[0];
                return opt ? (opt.textContent || "").trim() : "";
            }"""
        )
    except Exception:
        return ""


def run(years_range: str = "") -> None:
    years_dates = load_years_dates()
    draws_map = load_draws()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            locale="en-US",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        try:
            page.goto(URL, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector('select[formcontrolname="jahr"]', timeout=30000)
            page.wait_for_timeout(1500)

            for btn_text in ["Accept", "Agree", "Akzeptieren", "Alle akzeptieren"]:
                btn = page.locator(f'button:has-text("{btn_text}")').first
                if btn.is_visible(timeout=800):
                    btn.click(force=True)
                    page.wait_for_timeout(1000)
                    break

            dropdown_years = page.locator('select[formcontrolname="jahr"] option').evaluate_all(
                """(opts) => opts
                    .map((o) => Number(((o.textContent || o.value || "").trim().match(/\\b(20\\d{2})\\b/) || [])[1]))
                    .filter((y) => Number.isInteger(y))"""
            )
            all_years_desc = sorted(set(dropdown_years) | set(years_dates.keys()), reverse=True)
            years_to_process = parse_years_filter(years_range, all_years_desc)
            print("Years to process:", ", ".join(str(y) for y in years_to_process))

            init_nums = read_winning_numbers(page)
            last_key = f"{init_nums['mainNumbers']}|{init_nums['euroNumbers']}"

            for yr in years_to_process:
                prev_first_opt = ""
                try:
                    prev_first_opt = page.locator('select[formcontrolname="datum"] option').first.inner_text(timeout=2000)
                except Exception:
                    pass

                if not select_option_by_text(page, 'select[formcontrolname="jahr"]', str(yr)):
                    print(f"Year {yr} not found in dropdown.")
                    continue

                for _ in range(25):
                    page.wait_for_timeout(200)
                    try:
                        cur_first_opt = page.locator('select[formcontrolname="datum"] option').first.inner_text(timeout=1000)
                        if cur_first_opt and cur_first_opt != prev_first_opt:
                            break
                    except Exception:
                        pass
                page.wait_for_timeout(400)

                site_dates = page.locator('select[formcontrolname="datum"] option').evaluate_all(
                    """(opts) => opts
                        .map((o) => {
                            const txt = (o.textContent || "").trim();
                            const m = txt.match(/\\b(\\d{2}\\.\\d{2}\\.\\d{4})\\b/);
                            return m ? m[1] : null;
                        })
                        .filter(Boolean)"""
                )

                yr_dates_set = years_dates.get(yr, set())
                for d_str in site_dates:
                    if infer_year(d_str) == yr:
                        yr_dates_set.add(d_str)
                years_dates[yr] = yr_dates_set
                save_years_dates(years_dates)

                ordered_dates = sorted(yr_dates_set, key=parse_dmy_to_num, reverse=True)
                fetched_count = 0
                skipped_count = 0

                for dt in ordered_dates:
                    if dt in draws_map:
                        skipped_count += 1
                        continue

                    ok_date = select_option_by_text(page, 'select[formcontrolname="datum"]', dt)
                    if not ok_date:
                        page.wait_for_timeout(500)
                        ok_date = select_option_by_text(page, 'select[formcontrolname="datum"]', dt)
                    if not ok_date:
                        print(f"Date {dt} not found in dropdown for year {yr}.")
                        continue

                    parsed = None
                    for attempt in range(25):
                        page.wait_for_timeout(200)
                        cur = read_winning_numbers(page)
                        key = f"{cur['mainNumbers']}|{cur['euroNumbers']}"
                        if len(cur["mainNumbers"]) == 5 and len(cur["euroNumbers"]) == 2 and key != last_key:
                            last_key = key
                            parsed = cur
                            break
                        if attempt == 10:
                            select_option_by_text(page, 'select[formcontrolname="datum"]', dt)

                    if not parsed:
                        sel_txt = get_selected_date_label(page)
                        cur = read_winning_numbers(page)
                        if dt in sel_txt and len(cur["mainNumbers"]) == 5 and len(cur["euroNumbers"]) == 2:
                            last_key = f"{cur['mainNumbers']}|{cur['euroNumbers']}"
                            parsed = cur

                    if parsed:
                        candidate = {
                            "year": infer_year(dt, yr),
                            "date": dt,
                            "mainNumbers": parsed["mainNumbers"],
                            "euroNumbers": parsed["euroNumbers"],
                        }
                        if is_valid_draw(candidate):
                            draws_map[dt] = candidate
                            fetched_count += 1
                    else:
                        print(f"Could not read valid numbers for date {dt} (year {yr}).")

                total_draws = save_draws(draws_map)
                print(f"Year {yr}: fetched={fetched_count}, skipped={skipped_count}, total_draws={total_draws}")

        finally:
            browser.close()

    final_total = save_draws(draws_map)
    print(f"Done. Total draws saved: {final_total}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch Eurojackpot draws in Python.")
    parser.add_argument("--years", default=os.environ.get("YEARS_RANGE", ""), help="e.g. 2026 or 2026-2022")
    args = parser.parse_args()
    run(years_range=args.years)
