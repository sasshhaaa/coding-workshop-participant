import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, Chip, Stack, Divider, Alert,
  CircularProgress, Avatar, Paper, IconButton, Snackbar, Tooltip, Card,
  LinearProgress,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useMediaQuery } from "react-responsive";
import {
  teamsApi, individualsApi, projectsApi, achievementsApi, metadataApi,
  apiError, money, LEVELS, STAFF_TYPES, IMPACTS, STATUSES,
} from "../services/api";
import { can } from "../services/auth";
import EntityDialog from "../components/EntityDialog";

const initials = (name = "") =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const dateLabel = (v) =>
  v ? new Date(v).toLocaleDateString(undefined,
    { day: "numeric", month: "short", year: "numeric" }) : "not set";

const monthLabel = (v) =>
  new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "long" });

const toMonthInput = (v) => (v ? String(v).slice(0, 7) : "");
const toDateInput = (v) => (v ? String(v).slice(0, 10) : "");

const RAG = {
  green: { color: "success.main", label: "On track" },
  amber: { color: "warning.main", label: "At risk" },
  red: { color: "error.main", label: "Overdue" },
  complete: { color: "text.secondary", label: "Complete" },
};

const IMPACT_WEIGHT = { low: 1, medium: 2, high: 3 };

/* ---------------- people ---------------- */

function PersonCard({ p, isLead, onEdit, onDelete, mayUpdate, mayDelete }) {
  const showActions = mayUpdate || mayDelete;

  return (
    <Paper
      elevation={0}
      sx={{
        width: 260, flexShrink: 0, overflow: "hidden", border: 1,
        borderColor: isLead ? "primary.main" : "divider",
        bgcolor: isLead ? "primary.light" : "background.paper",
        transition: "border-color 120ms",
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      <Box sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center" }}>
        <Avatar sx={{
          width: 38, height: 38, fontSize: 13, fontWeight: 600, flexShrink: 0,
          bgcolor: isLead ? "primary.main" : "grey.200",
          color: isLead ? "#fff" : "text.secondary",
        }}>
          {initials(p.name)}
        </Avatar>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap>{p.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap
            sx={{ display: "block" }}>
            {p.role || p.level}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap
            sx={{ display: "block" }}>
            {p.location}
          </Typography>
        </Box>
      </Box>

      {(p.staff_type === "non-direct" || showActions) && (
        <>
          <Divider />
          <Box sx={{
            px: 1, py: 0.5, minHeight: 40, display: "flex",
            alignItems: "center", justifyContent: "space-between",
          }}>
            {p.staff_type === "non-direct"
              ? <Chip label="Non-direct" size="small" color="warning" />
              : <Box />}
            <Box sx={{ display: "flex", flexShrink: 0 }}>
              {mayUpdate && (
                <Tooltip title="Edit person" arrow>
                  <IconButton size="small" onClick={() => onEdit(p)}>
                    <EditIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              )}
              {mayDelete && (
                <Tooltip title="Remove person" arrow>
                  <IconButton size="small" color="error" onClick={() => onDelete(p)}>
                    <DeleteIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        </>
      )}
    </Paper>
  );
}

function Hierarchy({ members, onEdit, onDelete, mayUpdate, mayDelete }) {
  const byLevel = (lvl) => members.filter((m) => m.level === lvl);
  const leads = byLevel("lead");
  const mids = byLevel("member");
  const juniors = byLevel("junior");

  const Row = ({ label, people, isLead, connect }) => {
    if (!people.length) return null;
    return (
      <Box sx={{
        width: "100%", display: "flex",
        flexDirection: "column", alignItems: "center",
      }}>
        {connect && <Box sx={{ width: "2px", height: 28, bgcolor: "divider" }} />}
        <Typography variant="caption" sx={{
          mt: connect ? 1.5 : 0, mb: 1.5, px: 1.5, py: 0.25,
          borderRadius: 1, bgcolor: "grey.100", color: "text.secondary",
          fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          {label} · {people.length}
        </Typography>
        <Box sx={{
          display: "flex", flexWrap: "wrap", justifyContent: "center",
          alignItems: "flex-start", gap: 2, width: "100%",
        }}>
          {people.map((p) => (
            <PersonCard key={p.id} p={p} isLead={isLead}
              onEdit={onEdit} onDelete={onDelete}
              mayUpdate={mayUpdate} mayDelete={mayDelete} />
          ))}
        </Box>
      </Box>
    );
  };

  return (
    <Card elevation={0} sx={{ px: 2, py: 3.5 }}>
      <Box sx={{
        display: "flex", flexDirection: "column",
        alignItems: "center", width: "100%",
      }}>
        <Row label="Lead" people={leads} isLead />
        <Row label="Members" people={mids} connect={leads.length > 0} />
        <Row label="Juniors" people={juniors}
          connect={leads.length > 0 || mids.length > 0} />
      </Box>
    </Card>
  );
}

/* ---------------- projects ---------------- */

function ProjectRow({ p, onEdit, onDelete, mayUpdate, mayDelete }) {
  const rag = RAG[p.rag] || RAG.green;
  const progress = Number(p.progress_pct) || 0;
  const spend = p.budget_pct;
  const hasBudget = Number(p.budget_planned) > 0;

  return (
    <Stack direction="row" alignItems="stretch" sx={{ px: 3, py: 3 }}>
      <Box sx={{
        width: 5, borderRadius: 2, bgcolor: rag.color,
        flexShrink: 0, mr: 3,
      }} />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="center" gap={1.5}
          flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="body1" fontWeight={600}>{p.name}</Typography>
          <Chip label={String(p.status || "").replace("_", " ")}
            size="small" variant="outlined" />
          <Chip label={rag.label} size="small"
            sx={{ bgcolor: rag.color, color: "#fff" }} />
          {p.over_budget && (
            <Chip label="Over budget" size="small" color="error" />
          )}
        </Stack>

        {p.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {p.description}
          </Typography>
        )}

        <Stack direction={{ xs: "column", md: "row" }} gap={4}>
          <Box sx={{ flex: 1, maxWidth: 400 }}>
            <Stack direction="row" justifyContent="space-between"
              alignItems="baseline" sx={{ mb: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                Progress
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, color: rag.color }}>
                {progress}%
              </Typography>
            </Stack>

            <LinearProgress
              variant="determinate" value={progress}
              sx={{
                height: 8, borderRadius: 4, bgcolor: "grey.200",
                "& .MuiLinearProgress-bar": { bgcolor: rag.color },
              }}
            />

            <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Started {dateLabel(p.start_date)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Due {dateLabel(p.due_date)}
              </Typography>
            </Stack>
          </Box>

          {hasBudget && (
            <Box sx={{ flex: 1, maxWidth: 400 }}>
              <Stack direction="row" justifyContent="space-between"
                alignItems="baseline" sx={{ mb: 0.75 }}>
                <Typography variant="caption" color="text.secondary">
                  Budget used
                </Typography>
                <Typography variant="body2" sx={{
                  fontWeight: 700,
                  color: p.over_budget ? "error.main" : "text.primary",
                }}>
                  {spend}%
                </Typography>
              </Stack>

              <LinearProgress
                variant="determinate"
                value={Math.min(spend ?? 0, 100)}
                sx={{
                  height: 8, borderRadius: 4, bgcolor: "grey.200",
                  "& .MuiLinearProgress-bar": {
                    bgcolor: p.over_budget ? "error.main" : "primary.main",
                  },
                }}
              />

              <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {money(p.budget_spent)} of {money(p.budget_planned)}
                </Typography>
                <Typography variant="caption" sx={{
                  color: p.budget_remaining < 0 ? "error.main" : "text.secondary",
                  fontWeight: p.budget_remaining < 0 ? 600 : 400,
                }}>
                  {p.budget_remaining < 0
                    ? `${money(Math.abs(p.budget_remaining))} over`
                    : `${money(p.budget_remaining)} left`}
                </Typography>
              </Stack>
            </Box>
          )}
        </Stack>
      </Box>

      <Stack direction="row" alignItems="flex-start" sx={{ flexShrink: 0, ml: 2 }}>
        {mayUpdate && (
          <Tooltip title="Edit project" arrow>
            <IconButton size="small" onClick={() => onEdit(p)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {mayDelete && (
          <Tooltip title="Delete project" arrow>
            <IconButton size="small" color="error" onClick={() => onDelete(p)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}

/* ---------------- achievement chart ---------------- */

function AchievementChart({ achievements }) {
  if (!achievements.length) return null;

  const buckets = {};
  for (const a of achievements) {
    const key = String(a.month).slice(0, 7);
    if (!buckets[key]) buckets[key] = { score: 0, count: 0 };
    buckets[key].score += IMPACT_WEIGHT[a.impact] || 1;
    buckets[key].count += 1;
  }

  const keys = Object.keys(buckets).sort();
  const first = new Date(`${keys[0]}-01`);
  const last = new Date(`${keys[keys.length - 1]}-01`);

  const months = [];
  const cursor = new Date(first);
  while (cursor <= last && months.length < 24) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      key,
      label: cursor.toLocaleDateString(undefined, { month: "short" }),
      year: cursor.getFullYear(),
      score: buckets[key]?.score || 0,
      count: buckets[key]?.count || 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const peak = Math.max(...months.map((m) => m.score), 1);
  const best = months.reduce((a, b) => (b.score > a.score ? b : a), months[0]);
  const total = months.reduce((sum, m) => sum + m.count, 0);
  const highs = achievements.filter((a) => a.impact === "high").length;

  const W = 44;
  const GAP = 14;
  const H = 130;
  const chartWidth = months.length * (W + GAP);

  return (
    <Card elevation={0} sx={{ p: 3, mb: 2 }}>
      <Stack direction="row" justifyContent="space-between"
        alignItems="flex-start" flexWrap="wrap" gap={3} sx={{ mb: 3 }}>
        <Box sx={{ minWidth: 240 }}>
          <Typography variant="body1" fontWeight={600}>
            Achievement momentum
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Weighted by impact — high counts 3, medium 2, low 1
          </Typography>
        </Box>

        <Stack
          direction="row"
          divider={<Divider orientation="vertical" flexItem />}
          gap={3}
          sx={{ flexShrink: 0 }}
        >
          <Box sx={{ minWidth: 70 }}>
            <Typography variant="caption" color="text.secondary"
              sx={{ display: "block", mb: 0.25 }}>
              Total
            </Typography>
            <Typography variant="h6">{total}</Typography>
          </Box>
          <Box sx={{ minWidth: 90 }}>
            <Typography variant="caption" color="text.secondary"
              sx={{ display: "block", mb: 0.25 }}>
              High impact
            </Typography>
            <Typography variant="h6">{highs}</Typography>
          </Box>
          <Box sx={{ minWidth: 110 }}>
            <Typography variant="caption" color="text.secondary"
              sx={{ display: "block", mb: 0.25 }}>
              Best month
            </Typography>
            <Typography variant="h6" noWrap>
              {best.score > 0 ? `${best.label} ${best.year}` : "—"}
            </Typography>
          </Box>
        </Stack>
      </Stack>

      <Box sx={{ overflowX: "auto", pb: 1 }}>
        <svg
          width={Math.max(chartWidth, 320)}
          height={H + 48}
          role="img"
          aria-label="Achievement score by month"
        >
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1="0" x2={Math.max(chartWidth, 320)}
              y1={H - H * f} y2={H - H * f}
              stroke="#DCE3ED" strokeWidth="1"
            />
          ))}

          {months.map((m, i) => {
            const h = m.score > 0 ? Math.max((m.score / peak) * H, 8) : 0;
            const x = i * (W + GAP);
            const isPeak = m.score === peak && peak > 0;

            return (
              <g key={m.key}>
                {h > 0 && (
                  <rect
                    x={x} y={H - h} width={W} height={h} rx="4"
                    fill={isPeak ? "#0B5CD5" : "#85B7EB"}
                  >
                    <title>
                      {m.label} {m.year}: {m.count} achievement
                      {m.count === 1 ? "" : "s"}, score {m.score}
                    </title>
                  </rect>
                )}
                <text
                  x={x + W / 2} y={H + 19}
                  textAnchor="middle" fontSize="12" fill="#5A6B85"
                >
                  {m.label}
                </text>
                <text
                  x={x + W / 2} y={H + 34}
                  textAnchor="middle" fontSize="11" fill="#5A6B85"
                >
                  {String(m.year).slice(2)}
                </text>
              </g>
            );
          })}
        </svg>
      </Box>
    </Card>
  );
}

function SectionHeader({ title, action }) {
  return (
    <Stack direction="row" justifyContent="space-between"
      alignItems="center" sx={{ mb: 2 }}>
      <Typography variant="subtitle2">{title}</Typography>
      {action}
    </Stack>
  );
}

/* ---------------- page ---------------- */

export default function TeamDetail({ teamId, user, onBack }) {
  const [team, setTeam] = useState(null);
  const [projects, setProjects] = useState([]);
  const [meta, setMeta] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [personDialog, setPersonDialog] = useState(null);
  const [projectDialog, setProjectDialog] = useState(null);
  const [achievementDialog, setAchievementDialog] = useState(null);
  const [metaDialog, setMetaDialog] = useState(null);

  const isMobile = useMediaQuery({ maxWidth: 768 });

  const role = user?.role || "viewer";
  const mayCreate = can(role, "create");
  const mayUpdate = can(role, "update");
  const mayDelete = can(role, "delete");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTeam(await teamsApi.getOne(teamId));
    } catch (e) {
      setError(apiError(e));
      setLoading(false);
      return;
    }
    try {
      setProjects(await projectsApi.getAll({ team_id: teamId }));
    } catch {
      setProjects([]);
    }
    try {
      setMeta(await metadataApi.forEntity("team", teamId));
    } catch {
      setMeta([]);
    }
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  /* people */
  const personFields = [
    { name: "name", label: "Full name", required: true },
    { name: "email", label: "Email", required: true, type: "email" },
    { name: "role", label: "Job title" },
    {
      name: "level", label: "Level", required: true,
      options: LEVELS.map((l) => ({ value: l, label: l })),
      help: "Lead sits at the top of the chart, juniors at the bottom",
    },
    {
      name: "staff_type", label: "Staff type", required: true,
      options: STAFF_TYPES.map((s) => ({ value: s, label: s })),
    },
    { name: "location", label: "Location", required: true },
  ];

  const savePerson = async (form) => {
    try {
      const payload = { ...form, team_id: teamId };
      if (personDialog?.id) {
        await individualsApi.update(personDialog.id, payload);
        setToast("Person updated");
      } else {
        await individualsApi.create(payload);
        setToast("Person added");
      }
      load();
    } catch (e) { throw apiError(e); }
  };

  const removePerson = async (p) => {
    if (!window.confirm(`Remove ${p.name} from the organisation?`)) return;
    try {
      await individualsApi.remove(p.id);
      setToast("Person removed");
      load();
    } catch (e) { setError(apiError(e)); }
  };

  /* projects */
  const projectFields = [
    { name: "name", label: "Project name", required: true },
    { name: "description", label: "Description", multiline: true },
    {
      name: "status", label: "Status", required: true,
      options: STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") })),
    },
    { name: "start_date", label: "Start date", type: "date", required: true },
    {
      name: "due_date", label: "Due date", type: "date", required: true,
      help: "Overdue turns red; due within 14 days turns amber",
    },
    {
      name: "progress_pct", label: "Progress (%)", type: "number",
      required: true, min: 0, max: 100,
    },
    {
      name: "budget_planned", label: "Budget planned", type: "number", min: 0,
      help: "Leave at 0 if this project has no budget",
    },
    {
      name: "budget_spent", label: "Budget spent", type: "number", min: 0,
      help: "Spending ahead of progress flags the project as at risk",
    },
  ];

  const saveProject = async (form) => {
    try {
      const payload = { ...form, team_id: teamId };
      if (projectDialog?.id) {
        await projectsApi.update(projectDialog.id, payload);
        setToast("Project updated");
      } else {
        await projectsApi.create(payload);
        setToast("Project added");
      }
      load();
    } catch (e) { throw apiError(e); }
  };

  const removeProject = async (p) => {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    try {
      await projectsApi.remove(p.id);
      setToast("Project deleted");
      load();
    } catch (e) { setError(apiError(e)); }
  };

  /* achievements */
  const achievementFields = [
    { name: "title", label: "Achievement", required: true },
    { name: "description", label: "Description", multiline: true },
    {
      name: "month", label: "Month", required: true, type: "month",
      help: "The month this was delivered",
    },
    {
      name: "impact", label: "Impact", required: true,
      options: IMPACTS.map((i) => ({ value: i, label: i })),
      help: "Drives the height of the bar in the momentum chart",
    },
  ];

  const saveAchievement = async (form) => {
    try {
      const payload = { ...form, team_id: teamId };
      if (achievementDialog?.id) {
        await achievementsApi.update(achievementDialog.id, payload);
        setToast("Achievement updated");
      } else {
        await achievementsApi.create(payload);
        setToast("Achievement recorded");
      }
      load();
    } catch (e) { throw apiError(e); }
  };

  const removeAchievement = async (a) => {
    if (!window.confirm(`Delete "${a.title}"?`)) return;
    try {
      await achievementsApi.remove(a.id);
      setToast("Achievement deleted");
      load();
    } catch (e) { setError(apiError(e)); }
  };

  /* metadata */
  const metaFields = [
    {
      name: "key", label: "Attribute", required: true, maxLength: 100,
      help: "For example: cost_centre, function, tech_stack, formed",
    },
    { name: "value", label: "Value" },
  ];

  const saveMeta = async (form) => {
    try {
      const payload = { ...form, entity_type: "team", entity_id: teamId };
      if (metaDialog?.id) {
        await metadataApi.update(metaDialog.id, payload);
        setToast("Attribute updated");
      } else {
        await metadataApi.create(payload);
        setToast("Attribute added");
      }
      load();
    } catch (e) { throw apiError(e); }
  };

  const removeMeta = async (m) => {
    if (!window.confirm(`Remove "${m.key}"?`)) return;
    try {
      await metadataApi.remove(m.id);
      setToast("Attribute removed");
      load();
    } catch (e) { setError(apiError(e)); }
  };

  /* render */

  if (loading) {
    return <Box display="flex" justifyContent="center" p={6}><CircularProgress /></Box>;
  }
  if (!team) return <Alert severity="error">{error || "Team not found"}</Alert>;

  const members = team.members || [];
  const achievements = team.achievements || [];

  const budgetPlanned = projects.reduce(
    (s, p) => s + Number(p.budget_planned || 0), 0);
  const budgetSpent = projects.reduce(
    (s, p) => s + Number(p.budget_spent || 0), 0);

  return (
    <Box sx={{ py: 1 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={onBack} size="small"
        sx={{ mb: 2.5, ml: -1 }}>
        Back to dashboard
      </Button>

      {error && (
        <Alert severity="error" onClose={() => setError("")} sx={{ mb: 3 }}>{error}</Alert>
      )}

      <Stack direction="row" alignItems="flex-start" gap={1.5}
        flexWrap="wrap" sx={{ mb: 4 }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="h5" sx={{ mb: 0.5 }}>{team.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {team.location} · {team.member_count} people
            {team.org_leader ? ` · reports to ${team.org_leader}` : ""}
          </Typography>
        </Box>
        <Stack direction="row" gap={1} alignItems="center" sx={{ pt: 0.5 }}>
          {team.leader_offsite && (
            <Chip label={`Lead in ${team.leader_location}`} size="small"
              color="warning" variant="outlined" />
          )}
          <Chip label={`${team.non_direct_pct ?? 0}% non-direct`}
            size="small" color="primary" variant="outlined" />
          {budgetPlanned > 0 && (
            <Chip
              label={`${money(budgetSpent)} of ${money(budgetPlanned)}`}
              size="small"
              color={budgetSpent > budgetPlanned ? "error" : "default"}
              variant="outlined"
            />
          )}
        </Stack>
      </Stack>

      {/* metadata */}
      <SectionHeader
        title="Metadata"
        action={mayCreate && (
          <Button size="small" startIcon={<AddIcon />}
            onClick={() => setMetaDialog({})}>
            Add attribute
          </Button>
        )}
      />

      {meta.length === 0 ? (
        <Card elevation={0} sx={{ py: 3, px: 3, mb: 4 }}>
          <Typography variant="body2" color="text.secondary">
            No attributes set. Use these for cost centre, function, tech stack,
            and anything else that varies by team.
          </Typography>
        </Card>
      ) : (
        <Stack direction="row" gap={1.5} flexWrap="wrap" sx={{ mb: 4 }}>
          {meta.map((m) => (
            <Paper
              key={m.id}
              elevation={0}
              sx={{
                px: 2, py: 1.25, border: 1, borderColor: "divider",
                display: "flex", alignItems: "center", gap: 1.5,
              }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary"
                  sx={{ display: "block", textTransform: "uppercase",
                    letterSpacing: "0.05em", fontSize: 11 }}>
                  {m.key.replace(/_/g, " ")}
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {m.value || "—"}
                </Typography>
              </Box>
              {(mayUpdate || mayDelete) && (
                <Stack direction="row" sx={{ ml: 0.5 }}>
                  {mayUpdate && (
                    <IconButton size="small" onClick={() => setMetaDialog(m)}>
                      <EditIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  )}
                  {mayDelete && (
                    <IconButton size="small" color="error"
                      onClick={() => removeMeta(m)}>
                      <DeleteIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  )}
                </Stack>
              )}
            </Paper>
          ))}
        </Stack>
      )}

      <Divider sx={{ my: 4 }} />

      {/* hierarchy */}
      <SectionHeader
        title="Team hierarchy"
        action={mayCreate && (
          <Button size="small" startIcon={<AddIcon />}
            onClick={() => setPersonDialog({})}>
            Add person
          </Button>
        )}
      />

      {members.length === 0 ? (
        <Card elevation={0} sx={{ py: 4, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            No members yet. Add the first person to this team.
          </Typography>
        </Card>
      ) : (
        <Hierarchy members={members} onEdit={setPersonDialog} onDelete={removePerson}
          mayUpdate={mayUpdate} mayDelete={mayDelete} />
      )}

      <Divider sx={{ my: 4 }} />

      {/* projects */}
      <SectionHeader
        title="Ongoing projects"
        action={mayCreate && (
          <Button size="small" startIcon={<AddIcon />}
            onClick={() => setProjectDialog({})}>
            Add project
          </Button>
        )}
      />

      {projects.length === 0 ? (
        <Card elevation={0} sx={{ py: 4, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            No projects yet for this team.
          </Typography>
        </Card>
      ) : (
        <Card elevation={0}>
          {projects.map((p, i) => (
            <Box key={p.id}>
              {i > 0 && <Divider />}
              <ProjectRow p={p} onEdit={setProjectDialog} onDelete={removeProject}
                mayUpdate={mayUpdate} mayDelete={mayDelete} />
            </Box>
          ))}
        </Card>
      )}

      <Divider sx={{ my: 4 }} />

      {/* achievements */}
      <SectionHeader
        title="Monthly achievements"
        action={mayCreate && (
          <Button size="small" startIcon={<AddIcon />}
            onClick={() => setAchievementDialog({})}>
            Record achievement
          </Button>
        )}
      />

      <AchievementChart achievements={achievements} />

      {achievements.length === 0 ? (
        <Card elevation={0} sx={{ py: 4, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            No achievements recorded. Add the first one for this team.
          </Typography>
        </Card>
      ) : (
        <Card elevation={0}>
          {achievements.map((a, i) => (
            <Box key={a.id}>
              {i > 0 && <Divider />}
              <Stack direction="row" alignItems="flex-start" gap={2}
                sx={{ px: 3, py: 2.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1" fontWeight={600}>{a.title}</Typography>
                  {a.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {a.description}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary"
                    sx={{ display: "block", mt: 0.5 }}>
                    {monthLabel(a.month)}
                  </Typography>
                </Box>

                <Chip label={a.impact} size="small"
                  color={a.impact === "high" ? "success" : "default"}
                  variant="outlined" />

                <Stack direction="row" sx={{ flexShrink: 0 }}>
                  {mayUpdate && (
                    <Tooltip title="Edit achievement" arrow>
                      <IconButton size="small"
                        onClick={() => setAchievementDialog(a)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {mayDelete && (
                    <Tooltip title="Delete achievement" arrow>
                      <IconButton size="small" color="error"
                        onClick={() => removeAchievement(a)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Stack>
            </Box>
          ))}
        </Card>
      )}

      {/* dialogs */}

      <EntityDialog
        open={!!personDialog}
        title={personDialog?.id ? "Edit person" : "Add person"}
        fields={personFields}
        initial={personDialog?.id ? {
          name: personDialog.name, email: personDialog.email,
          role: personDialog.role ?? "", level: personDialog.level,
          staff_type: personDialog.staff_type, location: personDialog.location,
        } : {
          name: "", email: "", role: "", level: "member",
          staff_type: "direct", location: team.location,
        }}
        onClose={() => setPersonDialog(null)}
        onSave={savePerson}
      />

      <EntityDialog
        open={!!projectDialog}
        title={projectDialog?.id ? "Edit project" : "Add project"}
        fields={projectFields}
        initial={projectDialog?.id ? {
          name: projectDialog.name,
          description: projectDialog.description ?? "",
          status: projectDialog.status,
          start_date: toDateInput(projectDialog.start_date),
          due_date: toDateInput(projectDialog.due_date),
          progress_pct: projectDialog.progress_pct ?? 0,
          budget_planned: projectDialog.budget_planned ?? 0,
          budget_spent: projectDialog.budget_spent ?? 0,
        } : {
          name: "", description: "", status: "planning",
          start_date: "", due_date: "", progress_pct: 0,
          budget_planned: 0, budget_spent: 0,
        }}
        onClose={() => setProjectDialog(null)}
        onSave={saveProject}
      />

      <EntityDialog
        open={!!achievementDialog}
        title={achievementDialog?.id ? "Edit achievement" : "Record achievement"}
        fields={achievementFields}
        initial={achievementDialog?.id ? {
          title: achievementDialog.title,
          description: achievementDialog.description ?? "",
          month: toMonthInput(achievementDialog.month),
          impact: achievementDialog.impact,
        } : {
          title: "", description: "",
          month: new Date().toISOString().slice(0, 7),
          impact: "medium",
        }}
        onClose={() => setAchievementDialog(null)}
        onSave={saveAchievement}
      />

      <EntityDialog
        open={!!metaDialog}
        title={metaDialog?.id ? "Edit attribute" : "Add attribute"}
        fields={metaFields}
        initial={metaDialog?.id
          ? { key: metaDialog.key, value: metaDialog.value ?? "" }
          : { key: "", value: "" }}
        onClose={() => setMetaDialog(null)}
        onSave={saveMeta}
      />

      <Snackbar open={!!toast} autoHideDuration={3000}
        onClose={() => setToast("")} message={toast} />
    </Box>
  );
}