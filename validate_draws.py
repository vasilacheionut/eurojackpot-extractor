import json
import re
from collections import Counter
from pathlib import Path

DRAWS_FILE = Path("draws.json")


def main() -> None:
    if not DRAWS_FILE.exists():
        raise RuntimeError("draws.json does not exist.")

    data = json.loads(DRAWS_FILE.read_text(encoding="utf-8"))
    draws = data.get("draws")
    if not isinstance(draws, list) or len(draws) == 0:
        raise RuntimeError("draws.json is empty or missing 'draws' list.")

    seen_dates: set[str] = set()
    by_year: Counter[int] = Counter()
    identical_streak = 0
    prev_sig = ""

    for d in draws:
        dt = str(d.get("date", ""))
        if not re.match(r"^\d{2}\.\d{2}\.\d{4}$", dt):
            raise RuntimeError(f"Invalid date format: {dt}")
        if dt in seen_dates:
            raise RuntimeError(f"Duplicate date found: {dt}")
        seen_dates.add(dt)

        cal_year = int(dt[-4:])
        if int(d.get("year", 0)) != cal_year:
            raise RuntimeError(f"Year mismatch on {dt}: year={d.get('year')}")

        main_nums = d.get("mainNumbers")
        if not isinstance(main_nums, list) or len(main_nums) != 5:
            raise RuntimeError(f"Invalid mainNumbers on {dt}")
        if len(set(main_nums)) != 5 or any(
            not isinstance(n, int) or isinstance(n, bool) or n < 1 or n > 50 for n in main_nums
        ):
            raise RuntimeError(f"Out of range or duplicate mainNumbers on {dt}")

        euro_nums = d.get("euroNumbers")
        if not isinstance(euro_nums, list) or len(euro_nums) != 2:
            raise RuntimeError(f"Invalid euroNumbers on {dt}")
        if len(set(euro_nums)) != 2 or any(
            not isinstance(n, int) or isinstance(n, bool) or n < 1 or n > 12 for n in euro_nums
        ):
            raise RuntimeError(f"Out of range or duplicate euroNumbers on {dt}")

        sig = f"{main_nums}|{euro_nums}"
        if sig == prev_sig:
            identical_streak += 1
            if identical_streak >= 3:
                raise RuntimeError(f"Detected stuck/repeated numbers around {dt}: {sig}")
        else:
            identical_streak = 0
            prev_sig = sig

        by_year[cal_year] += 1

    print(f"Validation passed. Total draws: {len(draws)}")
    print("Draws per year:", dict(sorted(by_year.items(), reverse=True)))


if __name__ == "__main__":
    main()
