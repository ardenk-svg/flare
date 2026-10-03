# Project skills

Claude Code loads each `SKILL.md` folder here automatically. Vendored unmodified from upstream (MIT, license in each folder):

| Skill | Upstream | Use in Flare |
|---|---|---|
| `ui-ux-pro-max` | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (`.claude/skills/ui-ux-pro-max`, v2.13.0) | Web app UI (Person 4); needs Python 3 for its search script |
| `stop-slop` | https://github.com/hardikpandya/stop-slop | README, demo script, caller-facing iMessage copy |

The upstream ui-ux-pro-max repo also ships `design`, `brand`, `slides`, `banner-design`, `ui-styling`, `design-system`; they were not added.
Note: `ui-ux-pro-max/SKILL.md` invokes its script via `${CLAUDE_PLUGIN_ROOT}`; as a project skill, use the path `.claude/skills/ui-ux-pro-max/scripts/search.py` instead.
