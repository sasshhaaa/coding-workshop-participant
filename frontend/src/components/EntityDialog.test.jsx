import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EntityDialog from "./EntityDialog";

/**
 * Every entity in the app is created and edited through this one dialog, so a
 * validation bug here would show up in four different places at once.
 */

const FIELDS = [
  { name: "name", label: "Team name", required: true },
  { name: "email", label: "Email", type: "email" },
  { name: "location", label: "Location", required: true },
];

function setup(props = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();

  render(
    <EntityDialog
      open
      title="New team"
      fields={FIELDS}
      initial={{ name: "", email: "", location: "" }}
      onSave={onSave}
      onClose={onClose}
      {...props}
    />
  );

  return { onSave, onClose, user: userEvent.setup() };
}

describe("rendering", () => {
  it("shows the title and every field", () => {
    setup();
    expect(screen.getByText("New team")).toBeInTheDocument();
    expect(screen.getByLabelText(/team name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location/i)).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("New team")).not.toBeInTheDocument();
  });

  it("pre-fills values when editing", () => {
    setup({
      title: "Edit team",
      initial: { name: "Platform", email: "", location: "London" },
    });
    expect(screen.getByLabelText(/team name/i)).toHaveValue("Platform");
    expect(screen.getByLabelText(/location/i)).toHaveValue("London");
  });

  it("shows help text under a field that has it", () => {
    setup({
      fields: [{ name: "key", label: "Attribute", help: "For example: cost_centre" }],
      initial: { key: "" },
    });
    expect(screen.getByText("For example: cost_centre")).toBeInTheDocument();
  });
});

describe("validation", () => {
  it("blocks submission when a required field is empty", async () => {
    const { onSave, user } = setup();

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it("names each field that failed", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText("Team name is required")).toBeInTheDocument();
    expect(screen.getByText("Location is required")).toBeInTheDocument();
  });

  it("rejects whitespace as if the field were empty", async () => {
    const { onSave, user } = setup();

    await user.type(screen.getByLabelText(/team name/i), "   ");
    await user.type(screen.getByLabelText(/location/i), "   ");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    const { onSave, user } = setup();

    await user.type(screen.getByLabelText(/team name/i), "Platform");
    await user.type(screen.getByLabelText(/location/i), "London");
    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("accepts a well-formed email", async () => {
    const { onSave, user } = setup();

    await user.type(screen.getByLabelText(/team name/i), "Platform");
    await user.type(screen.getByLabelText(/location/i), "London");
    await user.type(screen.getByLabelText(/email/i), "priya@acme.com");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it("leaves an optional field alone when it's empty", async () => {
    const { onSave, user } = setup();

    await user.type(screen.getByLabelText(/team name/i), "Platform");
    await user.type(screen.getByLabelText(/location/i), "London");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it("enforces a number's lower bound", async () => {
    const { onSave, user } = setup({
      fields: [{ name: "progress", label: "Progress", type: "number", min: 0 }],
      initial: { progress: "" },
    });

    await user.type(screen.getByLabelText(/progress/i), "-5");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/0 or more/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("enforces a number's upper bound", async () => {
    const { onSave, user } = setup({
      fields: [
        { name: "progress", label: "Progress", type: "number", min: 0, max: 100 },
      ],
      initial: { progress: "" },
    });

    await user.type(screen.getByLabelText(/progress/i), "150");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/100 or less/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("submitting", () => {
  it("passes what was typed to onSave", async () => {
    const { onSave, user } = setup();

    await user.type(screen.getByLabelText(/team name/i), "Data science");
    await user.type(screen.getByLabelText(/location/i), "Chennai");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Data science", location: "Chennai" })
      )
    );
  });

  it("closes after a successful save", async () => {
    const { onClose, user } = setup();

    await user.type(screen.getByLabelText(/team name/i), "Platform");
    await user.type(screen.getByLabelText(/location/i), "London");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows the server's message and keeps the form open on failure", async () => {
    // Losing what the user typed because the server rejected it would be
    // worse than the rejection itself.
    const onSave = vi.fn().mockRejectedValue("a team with that name already exists");
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <EntityDialog
        open
        title="New team"
        fields={FIELDS}
        initial={{ name: "", email: "", location: "" }}
        onSave={onSave}
        onClose={onClose}
      />
    );

    await user.type(screen.getByLabelText(/team name/i), "Platform");
    await user.type(screen.getByLabelText(/location/i), "London");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/team name/i)).toHaveValue("Platform");
  });

  it("closes without saving when cancelled", async () => {
    const { onSave, onClose, user } = setup();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("select fields", () => {
  const withOptions = [
    {
      name: "level", label: "Level", required: true,
      options: [
        { value: "lead", label: "lead" },
        { value: "member", label: "member" },
      ],
    },
  ];

  it("offers every option", async () => {
    const user = userEvent.setup();
    render(
      <EntityDialog
        open title="Add person" fields={withOptions}
        initial={{ level: "member" }}
        onSave={vi.fn()} onClose={vi.fn()}
      />
    );

    await user.click(screen.getByLabelText(/level/i));

    expect(await screen.findByRole("option", { name: "lead" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "member" })).toBeInTheDocument();
  });
});