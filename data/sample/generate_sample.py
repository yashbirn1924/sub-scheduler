#!/usr/bin/env python3
"""Generate synthetic sample data for the public showcase (current 15-min block model).
Deterministic. Emits data/sample/data.js defining window.APP_DATA."""
import json, os

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
SPECIAL_BY_DAY = {"Mon": "PE", "Tue": "Music", "Wed": "Art", "Thu": "Library", "Fri": "Spanish"}


def blk(t0, t1, s, l):
    return {"t0": t0, "t1": t1, "s": s, "l": l, "c": "hi"}


def lead_day(day):
    sp = SPECIAL_BY_DAY[day]
    return [
        blk("08:00", "08:30", "busy", "Arrival"),
        blk("08:30", "09:45", "busy", "Reading"),
        blk("09:45", "10:00", "busy", "Snack"),
        blk("10:00", "10:15", "busy", "Recess"),
        blk("10:15", "11:00", "free", sp),            # class at a special → lead free
        blk("11:00", "11:45", "busy", "Writing"),
        blk("11:45", "12:30", "busy", "Lunch"),
        blk("12:30", "13:15", "busy", "Math"),
        blk("13:15", "14:00", "free", "Planning"),    # prep period
        blk("14:00", "15:00", "busy", "Science"),
        blk("15:00", "15:30", "busy", "Dismissal"),
    ]


def assistant_day(day):
    sp = SPECIAL_BY_DAY[day]
    return [
        blk("08:00", "08:30", "busy", "Arrival support"),
        blk("08:30", "09:45", "busy", "Small groups"),
        blk("09:45", "10:15", "busy", "Snack / Recess"),
        blk("10:15", "11:00", "free", sp),
        blk("11:00", "11:45", "free", "Available"),
        blk("11:45", "12:30", "busy", "Lunch duty"),
        blk("12:30", "13:15", "busy", "Centers"),
        blk("13:15", "14:00", "free", "Available"),
        blk("14:00", "15:30", "busy", "Afternoon support"),
    ]


def specialist_day(offset, subject):
    """Specialists teach a few blocks; free otherwise. offset staggers them."""
    slots = ["08:30", "09:15", "10:15", "11:00", "13:00", "13:45", "14:15"]
    day = [blk("08:00", "08:30", "free", "Prep")]
    teach_slots = {slots[(offset) % len(slots)], slots[(offset + 2) % len(slots)], slots[(offset + 4) % len(slots)]}
    grid = ["08:00", "08:30", "09:15", "10:00", "10:15", "11:00", "11:45",
            "12:30", "13:00", "13:45", "14:15", "15:00", "15:30"]
    out = []
    for i in range(len(grid) - 1):
        t0, t1 = grid[i], grid[i + 1]
        if t0 == "11:45":
            out.append(blk(t0, "12:30", "off", "Lunch")); continue
        if t0 == "12:30":
            continue
        if t0 in teach_slots:
            out.append(blk(t0, t1, "busy", subject))
        else:
            out.append(blk(t0, t1, "free", "Available"))
    return out


def staff_day():
    return [
        blk("08:00", "08:30", "busy", "Morning duty"),
        blk("08:30", "10:30", "free", "Available"),
        blk("10:30", "11:00", "busy", "Recess duty"),
        blk("11:00", "12:30", "busy", "Lunch coverage"),
        blk("12:30", "14:30", "free", "Available"),
        blk("14:30", "15:30", "busy", "Dismissal duty"),
    ]


def sub_day():
    return [blk("08:00", "15:30", "free", "Available to substitute")]


def week(fn, *a):
    return {d: fn(d, *a) if fn.__code__.co_argcount and "day" in fn.__code__.co_varnames[:1] else fn(*a)
            for d in DAYS}


def week_day(fn):
    return {d: fn(d) for d in DAYS}


def week_static(fn, *a):
    return {d: [dict(b) for b in fn(*a)] for d in DAYS}


people = []

def add(name, role, subject, room, weekfn):
    pid = "".join(c for c in name if c.isalnum())[:12] + str(len(people))
    people.append({"id": pid, "name": name, "role": role, "subject": subject, "room": room, "blocks": weekfn})

# Leads (homerooms)
leads = [("Ms. Alvarez", "K", "Rm 101"), ("Mr. Boone", "1/2", "Rm 102"),
         ("Ms. Cho", "1/2", "Rm 103"), ("Mr. Diaz", "3/4", "Rm 104"),
         ("Ms. Evans", "5", "Rm 105"), ("Ms. Ford", "ECE", "Rm 100")]
for name, grade, room in leads:
    add(name, "Lead", grade, room, week_day(lead_day))

# Assistants (ECE)
for name, room in [("Mr. Ito", "Rm 100"), ("Ms. Jain", "Rm 100")]:
    add(name, "Assistant", "ECE", room, week_day(assistant_day))

# Specialists
specialists = [("Coach Rivera", "PE"), ("Ms. Ono", "Music"), ("Mr. Delgado", "Art"),
               ("Ms. Frost", "Library"), ("Sra. Marin", "Spanish")]
for i, (name, subj) in enumerate(specialists):
    add(name, "Specialist", subj, "", week_static(specialist_day, i, subj))

# Staff
for name, subj in [("Mr. Park", "Front Desk"), ("Ms. Quill", "Aide")]:
    add(name, "Staff", subj, "", week_static(staff_day))

# Substitute
add("Sam Taylor", "Sub", "Substitute", "", week_static(sub_day))

data = {"people": people, "days": DAYS, "dayStart": "08:00", "dayEnd": "15:30", "step": 15}
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "data.js"), "w") as f:
    f.write("window.APP_DATA=" + json.dumps(data, separators=(",", ":")) + ";")
print(f"wrote data.js — {len(people)} people")
