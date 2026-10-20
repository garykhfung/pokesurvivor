"""Turn a PokéSurvivor snapshot into a Laya question, then shield the answer.

The model only sees a short English description. The game already marks which
directions are free of walls and imminent hazards; if Laya's top choice is not
one of those, the next-highest safe label is used instead.

    python bot/decide.py
"""

import math

# Phrases, not single words: Laya follows these more reliably.
MOVE_LABELS = [
    "stand still",
    "move north",
    "move north-east",
    "move east",
    "move south-east",
    "move south",
    "move south-west",
    "move west",
    "move north-west",
]

# Level-up stat titles are Spanish in the game. The sentence glosses them.
STAT_GLOSS = {
    "Vigor": "more max HP",
    "Potencia": "more damage",
    "Carrera": "faster movement",
    "Reflejos": "shorter move cooldown",
    "Coraza": "less damage taken",
    "Síntesis": "HP regeneration",
    "Imán": "pick up experience from farther away",
    "Aprendizaje": "more experience",
    "Baya Zidra": "heal a large amount now",
}

_BEARINGS = [
    "north", "north-east", "east", "south-east",
    "south", "south-west", "west", "north-west",
]


def load_agent():
    """Local Apple Silicon checkpoint. Downloads once into the Hugging Face cache."""
    import laya_mlx as laya
    return laya.load("aac6fef/laya-mlx")


def _bearing(dx, dy):
    # Game Y grows south, so north is negative dy.
    ang = math.atan2(float(dx), -float(dy))
    i = int((ang + math.pi / 8) % (2 * math.pi) / (math.pi / 4))
    return _BEARINGS[i]


def _range(dist):
    dist = float(dist)
    if dist < 36:
        return "on top of you"
    if dist < 80:
        return "very close"
    if dist < 160:
        return "close"
    if dist < 280:
        return "nearby"
    return "in the distance"


def _gloss(label, detail):
    hint = STAT_GLOSS.get(label)
    bits = [b for b in (hint, detail) if b]
    return (label + (" (" + ". ".join(bits) + ")" if bits else ""))


def describe(snap):
    """One or two sentences. Numbers stay out except HP percent and a few clocks."""
    hp = float(snap.get("hp") or 0)
    mx = float(snap.get("maxHp") or 1) or 1
    pct = round(100 * hp / mx)
    parts = [
        "You are Bulbasaur in a Pokémon survival run. "
        "HP %d percent. Level %d. Time %d seconds."
        % (pct, int(snap.get("level") or 1), int(snap.get("time") or 0))
    ]
    if snap.get("liquid"):
        parts.append("You are standing in %s, which hurts you." % snap["liquid"])
    foes = snap.get("enemies") or []
    if not foes:
        parts.append("No wild Pokémon are close.")
    else:
        bits = []
        for e in foes[:4]:
            kind = "boss " if e.get("boss") else ""
            bits.append(
                "a %s%s %s to the %s"
                % (kind, e.get("name") or "wild Pokémon", _range(e.get("dist") or 0),
                   _bearing(e.get("dx") or 0, e.get("dy") or 0))
            )
        parts.append("Threats: " + "; ".join(bits) + ".")
    hazards = snap.get("hazards") or []
    if hazards:
        bits = []
        for h in hazards[:3]:
            bits.append(
                "a %s zone %s to the %s, striking in %.1f seconds"
                % (h.get("kind") or "danger", _range(h.get("dist") or 0),
                   _bearing(h.get("dx") or 0, h.get("dy") or 0), float(h.get("delay") or 0))
            )
        parts.append("Danger on the ground: " + "; ".join(bits) + ".")
    else:
        parts.append("No danger zone is about to hit.")
    safe = [s for s in (snap.get("safe") or []) if s in MOVE_LABELS]
    parts.append("Safe directions: " + ", ".join(safe) + "." if safe else "No direction is safe.")
    phase = snap.get("phase")
    if phase in ("levelup", "item", "bond"):
        intro = {
            "levelup": "Choose one level-up reward.",
            "item": "Choose which held item to keep.",
            "bond": "Choose which moves to fuse.",
        }[phase]
        lines = []
        for i, c in enumerate(snap.get("cards") or [], 1):
            lines.append("Option %d: %s." % (i, _gloss(c.get("label") or "", c.get("detail") or "")))
        parts.append(intro + " " + " ".join(lines))
    return " ".join(parts)


def questions_for(snap):
    phase = snap.get("phase")
    if phase in ("levelup", "item", "bond"):
        labels = []
        for c in snap.get("cards") or []:
            lab = c.get("label") or ""
            if lab and lab not in labels:
                labels.append(lab)
        if not labels:
            return None
        return {
            "pick": {
                "type": "choice",
                "instructions": "Which option should the Pokémon take?",
                "criteria": labels,
            }
        }
    return {
        "move": {
            "type": "choice",
            "instructions": "Which way should the Pokémon move to stay alive?",
            "criteria": MOVE_LABELS,
        },
        "stay_hit": {
            "type": "noul",
            "instructions": "Is the Pokémon about to be hit if it stays where it is?",
        },
    }


def shield(choice, probabilities, safe):
    """Keep `choice` when it is safe. Otherwise the safe label with the next-highest probability.

    An empty safe list cannot be improved, so the raw choice is returned.
    ponytail: ties break by label text; a scored shortlist would need the model's own order.
    """
    allowed = []
    for s in safe or []:
        if isinstance(s, str) and s not in allowed:
            allowed.append(s)
    if not allowed:
        return choice
    if choice in allowed:
        return choice
    ranked = sorted((probabilities or {}).items(), key=lambda kv: (-float(kv[1]), str(kv[0])))
    for label, _p in ranked:
        if label in allowed:
            return label
    return allowed[0]


def decide(agent, snap):
    qs = questions_for(snap)
    if not qs:
        return {"action": "wait"}
    result = agent.predict(describe(snap), qs)
    answers = result["answers"]
    if "pick" in answers:
        ans = answers["pick"]
        labels = qs["pick"]["criteria"]
        label = shield(ans.get("choice"), ans.get("probabilities"), labels)
        index = labels.index(label) if label in labels else 0
        return {
            "action": "card",
            "label": label,
            "index": index,
            "shielded": label != ans.get("choice"),
        }
    ans = answers["move"]
    label = shield(ans.get("choice"), ans.get("probabilities"), snap.get("safe"))
    out = {
        "action": "move",
        "label": label,
        "shielded": label != ans.get("choice"),
    }
    stay = answers.get("stay_hit")
    if stay and "noul" in stay:
        out["stayHit"] = stay["noul"]
    return out


def _check():
    got = shield(
        "move north",
        {"move north": 0.7, "move west": 0.2, "stand still": 0.1},
        ["move west", "stand still"],
    )
    assert got == "move west", got
    assert shield("move west", {"move north": 0.9, "move west": 0.1}, ["move west"]) == "move west"
    text = describe({
        "phase": "playing",
        "hp": 40, "maxHp": 90, "level": 2, "time": 12,
        "enemies": [{"name": "Pidgey", "dist": 50, "dx": 0, "dy": -50, "boss": False}],
        "hazards": [],
        "safe": ["move west", "stand still"],
    })
    assert "Pidgey" in text and "north" in text and "move west" in text, text
    print("ok")


if __name__ == "__main__":
    _check()
