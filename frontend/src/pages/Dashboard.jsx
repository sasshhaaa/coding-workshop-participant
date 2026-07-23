import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Typography, Card, CardContent, Alert, CircularProgress,
  Chip, Stack, Divider, TextField, InputAdornment, Button,
  IconButton, Snackbar, Tooltip, MenuItem, LinearProgress,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ClearIcon from "@mui/icons-material/Clear";
import BarChartIcon from "@mui/icons-material/BarChart";
import { useMediaQuery } from "react-responsive";
import {
  teamsApi, individualsApi, projectsApi, apiError, money,
} from "../services/api";
import { can } from "../services/auth";
import EntityDialog from "../components/EntityDialog";
import ConfirmDialog from "../components/ConfirmDialog";

const THRESHOLD = 20;

function Metric({ label, value, tone = "default", hint }) {
  const tones = {
    default: { bg: "background.paper", fg: "text.primary", accent: "primary.main" },
    warning: { bg: "warning.light", fg: "warning.dark", accent: "warning.main" },
    danger: { bg: "error.light", fg: "error.dark", accent: "error.main" },
  };
  const t = tones[tone];

  return (
    <Tooltip title={hint || ""} arrow disableHoverListener={!hint}>
      <Card elevation={0} sx={{
        bgcolor: t.bg, flex: "1 1 190px", minWidth: 190,
        borderLeft: 4, borderLeftColor: t.accent,
      }}>
        <CardContent>
          <Typography variant="body2"
            sx={{ color: t.fg, opacity: 0.85, display: "block", mb: 0.75 }}>
            {label}
          </Typography>
          <Typography variant="h5"
            sx={{ color: t.fg, fontWeight: 700, lineHeight: 1.1 }}>
            {value}
          </Typography>
        </CardContent>
      </Card>
    </Tooltip>
  );
}

function RatioBar({ pct }) {
  const value = Number(pct) || 0;
  const over = value > THRESHOLD;

  return (
    <Tooltip
      title={`${value}% of this team is non-direct. The marker shows the ${THRESHOLD}% threshold.`}
      arrow
    >
      <Box sx={{ width: 150, flexShrink: 0 }}>
        <Box sx={{
          display: "flex", justifyContent: "space-between",
          alignItems: "baseline", mb: 0.75,
        }}>
          <Typography variant="caption" color="text.secondary">Non-direct</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: "primary.main" }}>
            {value}%
          </Typography>
        </Box>

        <Box sx={{ position: "relative" }}>
          <LinearProgress
            variant="determinate" value={Math.min(value, 100)}
            sx={{ height: 8, borderRadius: 4, bgcolor: "grey.200" }}
          />
          <Box sx={{
            position: "absolute", top: -4, left: `${THRESHOLD}%`,
            width: "2px", height: 16, bgcolor: "text.secondary", opacity: 0.45,
          }} />
        </Box>

        <Typography variant="caption" sx={{
          fontSize: 11, mt: 0.4, display: "block",
          color: over ? "error.main" : "text.secondary",
          fontWeight: over ? 600 : 400,
        }}>
          {over ? `over ${THRESHOLD}% limit` : `limit ${THRESHOLD}%`}
        </Typography>
      </Box>
    </Tooltip>
  );
}

function ProjectBar({ summary }) {
  if (!summary || summary.total === 0) {
    return (
      <Box sx={{ width: 150, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary"
          sx={{ display: "block", mb: 0.75 }}>
          Projects
        </Typography>
        <Typography variant="body2" color="text.secondary">None yet</Typography>
      </Box>
    );
  }

  const { total, progress, worst, red, amber } = summary;

  const tone = worst === "red"
    ? { color: "error.main", label: `${red} overdue` }
    : worst === "amber"
      ? { color: "warning.main", label: `${amber} at risk` }
      : { color: "success.main", label: "On track" };

  return (
    <Tooltip
      title={`${total} project${total === 1 ? "" : "s"} · ${progress}% average progress · ${tone.label}`}
      arrow
    >
      <Box sx={{ width: 150, flexShrink: 0 }}>
        <Box sx={{
          display: "flex", justifyContent: "space-between",
          alignItems: "baseline", mb: 0.75,
        }}>
          <Typography variant="caption" color="text.secondary">Projects</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: tone.color }}>
            {progress}%
          </Typography>
        </Box>

        <LinearProgress
          variant="determinate" value={progress}
          sx={{
            height: 8, borderRadius: 4, bgcolor: "grey.200",
            "& .MuiLinearProgress-bar": { bgcolor: tone.color },
          }}
        />

        <Typography variant="caption" sx={{
          color: tone.color, fontSize: 11, mt: 0.4,
          display: "block", fontWeight: 600,
        }}>
          {tone.label}
        </Typography>
      </Box>
    </Tooltip>
  );
}

function BudgetBar({ summary }) {
  if (!summary || summary.planned <= 0) {
    return (
      <Box sx={{ width: 150, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary"
          sx={{ display: "block", mb: 0.75 }}>
          Budget
        </Typography>
        <Typography variant="body2" color="text.secondary">Not set</Typography>
      </Box>
    );
  }

  const { planned, spent } = summary;
  const pct = Math.round((spent / planned) * 100);
  const over = spent > planned;

  return (
    <Tooltip title={`${money(spent)} spent of ${money(planned)} planned`} arrow>
      <Box sx={{ width: 150, flexShrink: 0 }}>
        <Box sx={{
          display: "flex", justifyContent: "space-between",
          alignItems: "baseline", mb: 0.75,
        }}>
          <Typography variant="caption" color="text.secondary">Budget</Typography>
          <Typography variant="body2" sx={{
            fontWeight: 700, color: over ? "error.main" : "text.primary",
          }}>
            {pct}%
          </Typography>
        </Box>

        <LinearProgress
          variant="determinate" value={Math.min(pct, 100)}
          sx={{
            height: 8, borderRadius: 4, bgcolor: "grey.200",
            "& .MuiLinearProgress-bar": {
              bgcolor: over ? "error.main" : "primary.main",
            },
          }}
        />

        <Typography variant="caption" sx={{
          fontSize: 11, mt: 0.4, display: "block",
          color: over ? "error.main" : "text.secondary",
          fontWeight: over ? 600 : 400,
        }}>
          {over ? "over budget" : `${money(planned - spent)} left`}
        </Typography>
      </Box>
    </Tooltip>
  );
}

/** Planned vs spent per team, drawn from the unsaved draft values. */
function BudgetChart({ groups }) {
  const rows = groups.filter(([, g]) => g.planned > 0 || g.spent > 0);
  if (!rows.length) return null;

  const peak = Math.max(...rows.map(([, g]) => Math.max(g.planned, g.spent)), 1);

  const W = 60;
  const GAP = 34;
  const H = 140;
  const chartWidth = rows.length * (W + GAP);

  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" alignItems="center" flexWrap="wrap"
        gap={3} sx={{ mb: 2 }}>
        <Typography variant="body2" fontWeight={600}>
          Allocation by team
        </Typography>
        <Stack direction="row" gap={2.5}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: "#B5D4F4" }} />
            <Typography variant="caption" color="text.secondary">Planned</Typography>
          </Stack>
          <Stack direction="row" alignItems="center" gap={1}>
            <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: "#0B5CD5" }} />
            <Typography variant="caption" color="text.secondary">Spent</Typography>
          </Stack>
        </Stack>
      </Stack>

      <Box sx={{ overflowX: "auto", pb: 1 }}>
        <svg
          width={Math.max(chartWidth, 320)}
          height={H + 42}
          role="img"
          aria-label="Planned and spent budget by team"
        >
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1="0" x2={Math.max(chartWidth, 320)}
              y1={H - H * f} y2={H - H * f}
              stroke="#DCE3ED" strokeWidth="1"
            />
          ))}

          {rows.map(([name, g], i) => {
            const x = i * (W + GAP);
            const plannedH = Math.max((g.planned / peak) * H, g.planned > 0 ? 4 : 0);
            const spentH = Math.max((g.spent / peak) * H, g.spent > 0 ? 4 : 0);
            const over = g.spent > g.planned && g.planned > 0;
            const short = name.length > 12 ? `${name.slice(0, 11)}…` : name;

            return (
              <g key={name}>
                <rect
                  x={x} y={H - plannedH} width={W / 2 - 2} height={plannedH}
                  rx="3" fill="#B5D4F4"
                >
                  <title>{name} planned: {money(g.planned)}</title>
                </rect>
                <rect
                  x={x + W / 2 + 2} y={H - spentH} width={W / 2 - 2} height={spentH}
                  rx="3" fill={over ? "#D62B1F" : "#0B5CD5"}
                >
                  <title>{name} spent: {money(g.spent)}</title>
                </rect>

                <text
                  x={x + W / 2} y={H + 18}
                  textAnchor="middle" fontSize="11.5" fill="#5A6B85"
                >
                  {short}
                </text>
                <text
                  x={x + W / 2} y={H + 33}
                  textAnchor="middle" fontSize="11"
                  fontWeight="600" fill={over ? "#D62B1F" : "#12233F"}
                >
                  {money(g.spent)}
                </text>
              </g>
            );
          })}
        </svg>
      </Box>
    </Box>
  );
}

/** Budget allocation: view where money went and edit it per project. */
function BudgetManager({ open, onClose, projects, teams, onSaved, canEdit }) {
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    const next = {};
    for (const p of projects) {
      next[p.id] = {
        planned: String(Number(p.budget_planned) || 0),
        spent: String(Number(p.budget_spent) || 0),
        team_id: p.team_id ?? "",
      };
    }
    setDrafts(next);
    setErr("");
  }, [open, projects]);

  const set = (id, field) => (e) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: e.target.value } }));

  const changed = projects.filter((p) => {
    const d = drafts[p.id];
    if (!d) return false;
    return Number(d.planned) !== Number(p.budget_planned || 0)
      || Number(d.spent) !== Number(p.budget_spent || 0)
      || String(d.team_id ?? "") !== String(p.team_id ?? "");
  });

  const draftTotals = projects.reduce(
    (acc, p) => {
      const d = drafts[p.id] || {};
      acc.planned += Number(d.planned) || 0;
      acc.spent += Number(d.spent) || 0;
      return acc;
    },
    { planned: 0, spent: 0 }
  );

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const orphans = changed.filter((p) => !drafts[p.id]?.team_id);
      if (orphans.length) {
        setErr(
          `Assign a team to ${orphans.map((p) => p.name).join(", ")} before saving.`
        );
        setSaving(false);
        return;
      }

      // The API validates the whole record, so send every field back.
      for (const p of changed) {
        const d = drafts[p.id];
        await projectsApi.update(p.id, {
          team_id: d.team_id,
          name: p.name,
          description: p.description ?? "",
          status: p.status,
          start_date: p.start_date ? String(p.start_date).slice(0, 10) : "",
          due_date: p.due_date ? String(p.due_date).slice(0, 10) : "",
          progress_pct: p.progress_pct ?? 0,
          budget_planned: Number(d.planned) || 0,
          budget_spent: Number(d.spent) || 0,
        });
      }
      onSaved(`${changed.length} project${changed.length === 1 ? "" : "s"} updated`);
      onClose();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  // Group by the team currently selected in the draft, not the saved value,
  // so the chart and totals move as soon as someone reassigns a project.
  const teamName = (id) =>
    teams.find((t) => String(t.id) === String(id))?.name || "No team assigned";

  const groups = {};
  for (const p of projects) {
    const key = teamName(drafts[p.id]?.team_id ?? p.team_id);
    if (!groups[key]) groups[key] = { items: [], planned: 0, spent: 0 };
    groups[key].items.push(p);
    groups[key].planned += Number(drafts[p.id]?.planned) || 0;
    groups[key].spent += Number(drafts[p.id]?.spent) || 0;
  }

  const ordered = Object.entries(groups).sort((a, b) => b[1].spent - a[1].spent);
  const spendOf = (p) => Number(drafts[p.id]?.spent) || 0;
  const maxSpend = Math.max(...projects.map(spendOf), 1);

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose}
      fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1 }}>
        Budget allocation
        <Typography variant="caption" color="text.secondary"
          sx={{ display: "block", fontWeight: 400 }}>
          {canEdit
            ? "Set what each project is allowed to spend, and what it has spent"
            : "Read-only — you need edit permissions to change budgets"}
        </Typography>
      </DialogTitle>

      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

        {projects.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
            No projects yet. Add one from a team page first.
          </Typography>
        ) : (
          <>
            <Box sx={{ mt: 1 }}>
              <BudgetChart groups={ordered} />
            </Box>

            <Divider sx={{ mb: 3.5 }} />

            <Stack spacing={3.5}>
              {ordered.map(([groupName, g]) => (
                <Box key={groupName}>
                  <Stack direction="row" justifyContent="space-between"
                    alignItems="baseline" gap={3} sx={{ mb: 2 }}>
                    <Typography variant="body1" fontWeight={600} noWrap
                      sx={{ minWidth: 0 }}>
                      {groupName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary"
                      sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                      {money(g.spent)} of {money(g.planned)}
                    </Typography>
                  </Stack>

                  <Stack spacing={3}>
                    {g.items.map((p) => {
                      const d = drafts[p.id]
                        || { planned: "0", spent: "0", team_id: "" };
                      const planned = Number(d.planned) || 0;
                      const spent = Number(d.spent) || 0;
                      const over = spent > planned && planned > 0;
                      const width = Math.round((spent / maxSpend) * 100);

                      return (
                        <Box key={p.id}>
                          <Stack direction={{ xs: "column", sm: "row" }}
                            alignItems={{ sm: "center" }} gap={2}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={600} noWrap>
                                {p.name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {String(p.status || "").replace("_", " ")}
                              </Typography>
                            </Box>

                            <TextField
                              select label="Team" size="small"
                              value={d.team_id}
                              onChange={set(p.id, "team_id")}
                              disabled={!canEdit || saving}
                              sx={{ width: 160 }}
                              error={!d.team_id}
                            >
                              <MenuItem value=""><em>Unassigned</em></MenuItem>
                              {teams.map((t) => (
                                <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                              ))}
                            </TextField>

                            <TextField
                              label="Planned" type="number" size="small"
                              value={d.planned}
                              onChange={set(p.id, "planned")}
                              disabled={!canEdit || saving}
                              sx={{ width: 120 }}
                              slotProps={{ htmlInput: { min: 0 } }}
                            />
                            <TextField
                              label="Spent" type="number" size="small"
                              value={d.spent}
                              onChange={set(p.id, "spent")}
                              disabled={!canEdit || saving}
                              sx={{ width: 120 }}
                              slotProps={{ htmlInput: { min: 0 } }}
                              error={over}
                            />
                          </Stack>

                          <Box sx={{ mt: 1.25 }}>
                            <LinearProgress
                              variant="determinate" value={width}
                              sx={{
                                height: 8, borderRadius: 4, bgcolor: "grey.200",
                                "& .MuiLinearProgress-bar": {
                                  bgcolor: over ? "error.main" : "primary.main",
                                },
                              }}
                            />
                            <Typography variant="caption" sx={{
                              mt: 0.4, display: "block",
                              color: over ? "error.main" : "text.secondary",
                              fontWeight: over ? 600 : 400,
                            }}>
                              {planned > 0
                                ? `${Math.round((spent / planned) * 100)}% of ${money(planned)}`
                                : "no budget planned"}
                              {over && ` — ${money(spent - planned)} over`}
                            </Typography>
                          </Box>
                        </Box>
                      );
                    })}
                  </Stack>

                  <Divider sx={{ mt: 3 }} />
                </Box>
              ))}

              <Stack direction="row" justifyContent="space-between"
                alignItems="baseline" gap={3}>
                <Typography variant="body1" fontWeight={600}>
                  Organisation total
                </Typography>
                <Typography variant="body1" fontWeight={600} sx={{
                  flexShrink: 0, whiteSpace: "nowrap",
                  color: draftTotals.spent > draftTotals.planned
                    ? "error.main" : "text.primary",
                }}>
                  {money(draftTotals.spent)} of {money(draftTotals.planned)}
                </Typography>
              </Stack>
            </Stack>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving}>
          {canEdit ? "Cancel" : "Close"}
        </Button>
        {canEdit && (
          <Button variant="contained" onClick={save}
            disabled={saving || changed.length === 0}>
            {saving
              ? "Saving…"
              : changed.length === 0
                ? "No changes"
                : `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default function Dashboard({ user, onSelectTeam }) {
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [dialog, setDialog] = useState(null);
  const [showBudget, setShowBudget] = useState(false);

  // Held as the record itself rather than a boolean, so the confirmation
  // always knows what it is about to delete.
  const [confirming, setConfirming] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [flag, setFlag] = useState("all");

  const isMobile = useMediaQuery({ maxWidth: 768 });

  const role = user?.role || "viewer";
  const mayCreate = can(role, "create");
  const mayUpdate = can(role, "update");
  const mayDelete = can(role, "delete");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [analytics, individuals] = await Promise.all([
        teamsApi.analytics(),
        individualsApi.getAll(),
      ]);
      setData(analytics);
      setPeople(individuals);
    } catch (e) {
      setError(apiError(e));
      setLoading(false);
      return;
    }

    try {
      setProjects(await projectsApi.getAll());
    } catch {
      setProjects([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const allTeams = useMemo(() => data?.teams || [], [data]);

  const byTeam = useMemo(() => {
    const map = {};
    for (const p of projects) {
      if (p.status === "cancelled") continue;
      const key = p.team_id;
      if (!key) continue;
      if (!map[key]) {
        map[key] = { total: 0, sum: 0, red: 0, amber: 0, planned: 0, spent: 0 };
      }
      map[key].total += 1;
      map[key].sum += Number(p.progress_pct) || 0;
      map[key].planned += Number(p.budget_planned) || 0;
      map[key].spent += Number(p.budget_spent) || 0;
      if (p.rag === "red") map[key].red += 1;
      if (p.rag === "amber") map[key].amber += 1;
    }

    const out = {};
    for (const [key, v] of Object.entries(map)) {
      out[key] = {
        total: v.total,
        progress: Math.round(v.sum / v.total),
        red: v.red,
        amber: v.amber,
        planned: v.planned,
        spent: v.spent,
        worst: v.red > 0 ? "red" : v.amber > 0 ? "amber" : "green",
      };
    }
    return out;
  }, [projects]);

  const locations = useMemo(
    () => [...new Set(allTeams.map((t) => t.location).filter(Boolean))].sort(),
    [allTeams]
  );

  const teams = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allTeams.filter((t) => {
      const matchesSearch = !term
        || t.name.toLowerCase().includes(term)
        || (t.location || "").toLowerCase().includes(term)
        || (t.leader_name || "").toLowerCase().includes(term);

      const matchesLocation = location === "all" || t.location === location;
      const s = byTeam[t.id];

      const matchesFlag = flag === "all"
        || (flag === "over_threshold" && Number(t.non_direct_pct) > THRESHOLD)
        || (flag === "remote_lead" && t.leader_offsite)
        || (flag === "no_leader" && !t.leader_id)
        || (flag === "non_direct_lead" && t.leader_staff_type === "non-direct")
        || (flag === "projects_at_risk"
            && (s?.worst === "red" || s?.worst === "amber"))
        || (flag === "over_budget" && s && s.planned > 0 && s.spent > s.planned);

      return matchesSearch && matchesLocation && matchesFlag;
    });
  }, [allTeams, search, location, flag, byTeam]);

  const filtersActive = search || location !== "all" || flag !== "all";

  const clearFilters = () => {
    setSearch("");
    setLocation("all");
    setFlag("all");
  };

  const fields = [
    { name: "name", label: "Team name", required: true },
    { name: "location", label: "Location", required: true },
    {
      name: "leader_id", label: "Team leader",
      options: [
        { value: "", label: "No leader" },
        ...people.map((p) => ({ value: p.id, label: `${p.name} (${p.location})` })),
      ],
    },
    { name: "org_leader", label: "Reports to", help: "Organisation leader name" },
  ];

  const save = async (form) => {
    try {
      if (dialog?.id) {
        await teamsApi.update(dialog.id, form);
        setToast("Team updated");
      } else {
        await teamsApi.create(form);
        setToast("Team created");
      }
      load();
    } catch (e) {
      throw apiError(e);
    }
  };

  const remove = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      await teamsApi.remove(confirming.id);
      setToast(`"${confirming.name}" deleted`);
      setConfirming(null);
      load();
    } catch (e) {
      setError(apiError(e));
      setConfirming(null);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" p={6}><CircularProgress /></Box>;
  }

  const summaries = Object.values(byTeam);
  const atRisk = summaries.filter(
    (s) => s.worst === "red" || s.worst === "amber").length;
  const totalPlanned = projects.reduce(
    (s, p) => s + (Number(p.budget_planned) || 0), 0);
  const totalSpent = projects.reduce(
    (s, p) => s + (Number(p.budget_spent) || 0), 0);
  const overBudgetTeams = summaries.filter(
    (s) => s.planned > 0 && s.spent > s.planned).length;

  return (
    <Box sx={{ py: 1 }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Organisation health</Typography>
      <Typography variant="body2" color="text.secondary"
        sx={{ display: "block", mb: 3.5 }}>
        Team composition, delivery, and spend across the organisation
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError("")} sx={{ mb: 3 }}>{error}</Alert>
      )}

      {role === "viewer" && (
        <Alert severity="info" sx={{ mb: 3 }}>
          You have read-only access. Contact an admin to request edit permissions.
        </Alert>
      )}

      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Overview</Typography>
      <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 4 }}>
        <Metric label="Teams" value={data.total_teams} />
        <Metric label="People" value={data.total_people} />
        <Metric label="Locations" value={data.locations} />
        <Metric label="Reporting to org lead" value={data.reporting_to_org_leader} />
      </Stack>

      <Stack direction="row" alignItems="center" gap={2} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">Budget</Typography>
        <Button size="small" startIcon={<BarChartIcon />}
          onClick={() => setShowBudget(true)}>
          {mayUpdate ? "Manage allocation" : "View breakdown"}
        </Button>
      </Stack>

      <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 4 }}>
        <Metric label="Total planned" value={money(totalPlanned)}
          hint="Sum of budget planned across every project" />
        <Metric label="Total spent" value={money(totalSpent)}
          tone={totalSpent > totalPlanned && totalPlanned > 0 ? "danger" : "default"}
          hint="Sum of budget spent across every project" />
        <Metric label="Remaining" value={money(totalPlanned - totalSpent)}
          tone={totalPlanned - totalSpent < 0 ? "danger" : "default"} />
        <Metric label="Teams over budget" value={overBudgetTeams}
          tone={overBudgetTeams > 0 ? "danger" : "default"}
          hint="Teams whose project spend exceeds what was planned" />
      </Stack>

      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Attention required</Typography>
      <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 4.5 }}>
        <Metric label="Leader not co-located" value={data.leader_not_colocated}
          tone="warning"
          hint="Team lead is based in a different location to the team" />
        <Metric label="Non-direct leader" value={data.leader_non_direct}
          tone="warning"
          hint="Team is led by a contractor rather than a direct employee" />
        <Metric label={`Non-direct over ${THRESHOLD}%`}
          value={data.non_direct_over_20pct} tone="danger"
          hint={`Non-direct staff as a share of total headcount exceeds ${THRESHOLD}%`} />
        <Metric label="Teams with projects at risk" value={atRisk}
          tone={atRisk > 0 ? "danger" : "default"}
          hint="At least one project overdue, on hold, or behind schedule" />
      </Stack>

      <Stack
        direction={isMobile ? "column" : "row"}
        justifyContent="space-between"
        alignItems={isMobile ? "stretch" : "center"}
        gap={2} sx={{ mb: 2 }}
      >
        <Typography variant="subtitle2" sx={{ flexShrink: 0 }}>
          Teams
          {filtersActive && (
            <Typography component="span" variant="caption" color="text.secondary"
              sx={{ ml: 1, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
              {teams.length} of {allTeams.length}
            </Typography>
          )}
        </Typography>

        <Stack direction={isMobile ? "column" : "row"} gap={1.5} sx={{ flexShrink: 0 }}>
          <TextField
            placeholder="Search name, location, lead"
            value={search} onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: isMobile ? 0 : 250 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
              ),
            }}
          />

          <TextField select value={location}
            onChange={(e) => setLocation(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="all">All locations</MenuItem>
            {locations.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
          </TextField>

          <TextField select value={flag}
            onChange={(e) => setFlag(e.target.value)} sx={{ minWidth: 195 }}>
            <MenuItem value="all">All teams</MenuItem>
            <MenuItem value="over_threshold">Non-direct over {THRESHOLD}%</MenuItem>
            <MenuItem value="projects_at_risk">Projects at risk</MenuItem>
            <MenuItem value="over_budget">Over budget</MenuItem>
            <MenuItem value="remote_lead">Lead not co-located</MenuItem>
            <MenuItem value="non_direct_lead">Non-direct lead</MenuItem>
            <MenuItem value="no_leader">No leader assigned</MenuItem>
          </TextField>

          {filtersActive && (
            <Tooltip title="Clear filters" arrow>
              <IconButton onClick={clearFilters}>
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {mayCreate && (
            <Button variant="contained" startIcon={<AddIcon />}
              onClick={() => setDialog({})} sx={{ whiteSpace: "nowrap" }}>
              New team
            </Button>
          )}
        </Stack>
      </Stack>

      <Card elevation={0}>
        {teams.length === 0 && (
          <Box sx={{ py: 5, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {filtersActive
                ? "No teams match these filters."
                : "No teams yet. Create one to get started."}
            </Typography>
          </Box>
        )}

        {teams.map((t, i) => (
          <Box key={t.id}>
            {i > 0 && <Divider />}
            <Stack
              direction={isMobile ? "column" : "row"}
              alignItems={isMobile ? "flex-start" : "center"}
              divider={isMobile ? null : (
                <Divider orientation="vertical" flexItem sx={{ my: 1 }} />
              )}
              gap={3}
              sx={{
                px: 2.5, py: 2.25, transition: "background-color 120ms",
                "&:hover": { bgcolor: "grey.100" },
              }}
            >
              <Box
                onClick={() => onSelectTeam(t.id)}
                sx={{ cursor: "pointer", flex: 1, minWidth: 180, overflow: "hidden" }}
              >
                <Stack direction="row" alignItems="center" gap={0.5}>
                  <Typography variant="body1" fontWeight={600} noWrap>
                    {t.name}
                  </Typography>
                  <ChevronRightIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                </Stack>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {t.location} · {t.member_count} people
                  {t.leader_name ? ` · led by ${t.leader_name}` : " · no leader"}
                </Typography>
              </Box>

              <RatioBar pct={t.non_direct_pct} />
              <ProjectBar summary={byTeam[t.id]} />
              <BudgetBar summary={byTeam[t.id]} />

              <Stack direction="row" gap={1} alignItems="center"
                flexWrap="wrap" sx={{ width: 120, flexShrink: 0 }}>
                {t.leader_offsite && (
                  <Chip label="Remote lead" size="small"
                    color="warning" variant="outlined" />
                )}
                {t.leader_staff_type === "non-direct" && (
                  <Chip label="Non-direct lead" size="small"
                    color="warning" variant="outlined" />
                )}
              </Stack>

              <Stack direction="row" sx={{ flexShrink: 0 }}>
                {mayUpdate && (
                  <Tooltip title="Edit team" arrow>
                    <IconButton onClick={() => setDialog(t)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {mayDelete && (
                  <Tooltip title="Delete team" arrow>
                    <IconButton color="error" onClick={() => setConfirming(t)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Stack>
          </Box>
        ))}
      </Card>

      <BudgetManager
        open={showBudget}
        onClose={() => setShowBudget(false)}
        projects={projects}
        teams={allTeams}
        canEdit={mayUpdate}
        onSaved={(msg) => { setToast(msg); load(); }}
      />

      <EntityDialog
        open={!!dialog}
        title={dialog?.id ? "Edit team" : "New team"}
        fields={fields}
        initial={dialog?.id ? {
          name: dialog.name, location: dialog.location,
          leader_id: dialog.leader_id ?? "", org_leader: dialog.org_leader ?? "",
        } : { name: "", location: "", leader_id: "", org_leader: "" }}
        onClose={() => setDialog(null)}
        onSave={save}
      />

      <ConfirmDialog
        open={!!confirming}
        title="Delete team"
        message={`Delete "${confirming?.name}"?`}
        consequence="Its projects and achievements will be removed too. People stay in the directory, unassigned. This cannot be undone."
        onConfirm={remove}
        onClose={() => setConfirming(null)}
        busy={deleting}
      />

      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast("")}
        message={toast}
      />
    </Box>
  );
}