# Working with tix

This project is managed by **tix**. As an AI agent, follow these rules. They
are not optional.

## What is tix?

Tix is a git-native ticket system: tickets are files, projects are git
branches. Ticket data lives in a `.tix/` directory next to the code, as its
own git repository.

- Each ticket is a directory named with a ULID, containing `title.md`,
  `body.md`, a status marker (`s=b|t|w|d` = backlog/todo/doing/done), and a
  priority marker (`p=a|b|c|z` = high/medium/low/default).
- Projects are git branches inside `.tix/` — switch with `tix switch`.
- Every tix operation is an atomic git commit.
- Sync with `tix push` / `tix pull`. Works offline.

## Rules

1. **No ticket, no work.** Every commit requires a tix ticket — code, config,
   docs, tests. No ticket? Ask the user or create one.
2. **Commit format:** subject is the ticket title verbatim; body is the
   ticket ID (full ULID), nothing else.
3. **One ticket = one small, complete, shippable unit.** If it would take
   many sessions or touch unrelated areas, split it. No "phase 1 / phase 2"
   tickets that ship broken code.
4. **YAGNI.** Write only what the ticket asks for. No speculative features,
   options, abstractions, hooks, or error handling for impossible cases. Three
   similar lines beats a premature abstraction.
5. **Never write code for a future ticket**, even if you "know it's coming".
6. **Do not guess.** If the ticket is ambiguous, ask the user. Speculative
   code ships the wrong feature confidently.
7. If scope creeps mid-ticket, **stop**: cut the extra, or open a new ticket.

## Writing tickets

Use this template for every ticket body. Keep it tight — no prose paragraphs.

```
Why: <1 line — what problem this solves / why it matters now>

Scope:
- <bullet — concrete change>
- <bullet>
- <bullet>

Out of scope:
- <thing a reader might expect but is deliberately deferred>

Acceptance:
- <executable check, e.g. `curl X` returns Y, file exists, test passes>
- <executable check>
```

Title: imperative phrase ("Add X verification", "Wire Y to Z"). No IDs,
dates, or emoji.

Aim for 3-6 scope bullets. Prefer vertical slices (thinnest end-to-end
change for one observable behavior) over horizontal layers ("build the
service layer"). A skeleton ticket can be tiny — one route + one log line is
fine.

Acceptance must be executable, not narrative. "Verification works" is weak;
"curl with bad sig → 401, valid → 200" is testable.

Before writing your first ticket on a new project, skim a few recent `done`
tickets to calibrate to the project's sizing and tone — the rules above are
the minimum bar, not a rigid format.

Set priority when there's a clear reason: `-p a` for blockers or foundational
work, `-p c` for nice-to-haves. Otherwise omit — `z` is the default for
normal work.

## Commands

Run `tix --help` (and `tix <command> --help`) first to learn the available
commands.

**Mutations must go through `tix`** (`add`, `mv`, `amend`, `push`, `pull`,
…). Editing files inside `.tix/` directly corrupts the git history.

**Reads** — use Unix tools on `.tix/` (`ls`, `cat`, `grep`, `find`, `rg`,
`git -C .tix log`, …). Skip `tix ls`/`show`/`log` — they fail noisily on
empty result sets.

List all tickets with status, priority, and title:

```bash
for d in .tix/*/; do id=$(basename "$d"); st=$(ls "$d" | grep '^s=' | head -1); pr=$(ls "$d" | grep '^p=' | head -1); title=$(cat "$d/title.md" 2>/dev/null); echo "$id | $st | $pr | $title"; done
```

## Modes

At session start the user may set your mode. These add to the universal
rules above.

**Plan mode** — shape work into tickets; do not write code.

- Talk with the user; ask clarifying questions until scope is clear.
- Use the "Writing tickets" template.
- Stop after tickets are written.

**Implement mode** — execute one ticket faithfully.

- Pick a ticket; `tix mv <id> doing`.
- Write only what the ticket says. No scope expansion.
- If the ticket is too large, you may split it into smaller tickets via
  the "Writing tickets" template — but never expand scope.
- Commit with title as subject and ticket ID as the body, then
  `tix mv <id> done`.

**Navigate mode** — user drives, you guide.

- User writes the code; you suggest the next step, name files/APIs, spot
  bugs, and answer questions.
- It's a conversation: give **one** next step, then wait. Do not dump the
  full plan up front. The user will signal when ready for the next step.
- Hints, not paste-blocks. No code dumps or numbered step lists.
- User runs commands themselves unless they explicitly hand one off.
- You manage the tix lifecycle: pick the next ticket, `tix mv <id> doing`
  when starting, `tix mv <id> done` after the commit lands. The user
  should not have to ask.
- Still bound by the universal rules (ticket required, commit format, etc.).

If no mode is set, ask the user which mode you're in.

## Workflow

```
# find/pick a ticket (or `tix add` if none exists)
tix mv <id> doing
# ...implement only what the ticket says...
git commit -m "<title>" -m "<id>"
tix mv <id> done
```
