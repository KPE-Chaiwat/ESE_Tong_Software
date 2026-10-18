import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { FieldMessage } from "./field-message";
import { FreshnessChip } from "./freshness-chip";
import type { IconName } from "./icon";
import { StateBanner } from "./state-banner";
import { StatusPill, type StatusVariant } from "./status-pill";
import { StatusStrip, type StripTone } from "./status-strip";

function mockReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const PILLS: [StatusVariant, IconName, string][] = [
  ["idle", "plug", "Not connected"],
  ["connecting", "loader", "Connecting…"],
  ["connected", "link", "Connected"],
  ["polling", "activity", "Polling"],
  ["paused", "pause", "Paused"],
  ["timeout", "timer-off", "Timeout"],
  ["exception", "octagon-x", "Exception 02"],
  ["badResponse", "triangle-alert", "Bad response"],
  ["disconnected", "unplug", "Disconnected"],
  ["offline", "wifi-off", "Offline"],
  ["waiting", "loader", "Waiting…"],
];

describe("StatusPill title and full label", () => {
  it("carries a tooltip", () => {
    const { container } = render(
      <StatusPill
        variant="timeout"
        icon="timer-off"
        label="Timeout"
        title="Timeout: slave 5 did not respond."
      />,
    );
    expect(container.firstElementChild).toHaveAttribute(
      "title",
      "Timeout: slave 5 did not respond.",
    );
  });

  it("a short label is hidden from assistive technology and the full label is its name", () => {
    render(
      <StatusPill variant="exception" icon="octagon-x" label="Exc 02" fullLabel="Exception 02" />,
    );
    expect(screen.getByText("Exc 02")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Exception 02")).toHaveClass("sr-only");
  });

  it("without a full label the text is the name", () => {
    render(<StatusPill variant="paused" icon="pause" label="Paused" />);
    expect(screen.getByText("Paused")).not.toHaveAttribute("aria-hidden");
  });

  it("an icon-less pill is allowed (the summary chip with no polls)", () => {
    const { container } = render(<StatusPill variant="paused" icon={null} label="No polls" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("No polls")).toBeVisible();
  });
});

describe("StatusPill", () => {
  it.each(PILLS)("%s shows both its icon and its text label", (variant, icon, label) => {
    const { container } = render(<StatusPill variant={variant} icon={icon} label={label} />);
    expect(container.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
    expect(screen.getByText(label)).toBeVisible();
    expect(container.firstElementChild).toHaveAttribute("data-variant", variant);
  });

  it.each(["exception", "disconnected"] as const)(
    "%s uses the error tint and border, never a solid error fill",
    (variant) => {
      const { container } = render(<StatusPill variant={variant} icon="octagon-x" label="x" />);
      const classes = container.firstElementChild?.className ?? "";
      expect(classes).toContain("bg-error-tint");
      expect(classes).toContain("border-error");
      expect(classes).not.toMatch(/\bbg-error(?![-\w])/);
      expect(container.querySelector("svg")?.getAttribute("class")).toContain("text-error");
    },
  );

  it("the compact size is smaller than the default", () => {
    const { container: a } = render(
      <StatusPill variant="paused" icon="pause" label="P" size="sm" />,
    );
    const { container: b } = render(<StatusPill variant="paused" icon="pause" label="P" />);
    expect(a.firstElementChild?.className).toContain("h-6");
    expect(b.firstElementChild?.className).toContain("h-7");
  });

  it("uses dark text on the warning and success fills", () => {
    const { container: a } = render(<StatusPill variant="timeout" icon="timer-off" label="T" />);
    const { container: b } = render(<StatusPill variant="polling" icon="activity" label="P" />);
    expect(a.firstElementChild?.className).toContain("bg-warning");
    expect(a.firstElementChild?.className).toContain("text-dark");
    expect(b.firstElementChild?.className).toContain("bg-success");
    expect(b.firstElementChild?.className).toContain("text-dark");
  });
});

describe("StateBanner", () => {
  it.each([
    ["neutral", "loader", "Connecting to 192.168.1.10:502…"],
    ["warning", "timer-off", "Timeout: slave 1 did not respond within 1000 ms."],
    ["error", "octagon-x", "Exception 02 (Illegal data address) from slave 1."],
  ] as const)("%s shows icon and text", (variant, icon, text) => {
    const { container } = render(
      <StateBanner variant={variant} icon={icon}>
        {text}
      </StateBanner>,
    );
    expect(container.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
    expect(screen.getByText(text)).toBeVisible();
    expect(container.firstElementChild).toHaveAttribute("data-variant", variant);
  });

  it("error banners use a tint and a left border, not a solid fill", () => {
    const { container } = render(
      <StateBanner variant="error" icon="unplug">
        Lost
      </StateBanner>,
    );
    const classes = container.firstElementChild?.className ?? "";
    expect(classes).toContain("bg-error-tint");
    expect(classes).toContain("border-l-4");
    expect(classes).not.toMatch(/\bbg-error(?![-\w])/);
  });

  it("renders at most two actions and calls them", async () => {
    const onA = vi.fn();
    const onB = vi.fn();
    render(
      <StateBanner
        variant="error"
        icon="unplug"
        actions={[
          { id: "a", label: "Reconnect", onClick: onA, primary: true },
          { id: "b", label: "Dismiss", onClick: onB },
          { id: "c", label: "Third", onClick: vi.fn() },
        ]}
      >
        Lost
      </StateBanner>,
    );
    expect(screen.queryByRole("button", { name: "Third" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).toHaveBeenCalledTimes(1);
  });
});

describe("FieldMessage", () => {
  it.each([
    ["error", "circle-x"],
    ["warning", "triangle-alert"],
  ] as const)("%s shows an icon and the text, with an id for aria-describedby", (kind, icon) => {
    const { container } = render(
      <FieldMessage kind={kind} id="host-msg">
        Enter a host name or IPv4 address.
      </FieldMessage>,
    );
    expect(container.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
    expect(screen.getByText("Enter a host name or IPv4 address.")).toBeVisible();
    expect(container.querySelector("#host-msg")).toBeInTheDocument();
  });

  it("keeps the warning icon dark (orange is not allowed as an icon on light)", () => {
    const { container } = render(
      <FieldMessage kind="warning" id="w">
        Careful
      </FieldMessage>,
    );
    expect(container.querySelector("svg")?.getAttribute("class")).not.toMatch(/text-warning/);
  });
});

describe("FreshnessChip", () => {
  it.each([
    ["live", "circle-check", "Updated 14:02:11.540"],
    ["loading", "loader", "Waiting for first response…"],
    ["stale", "clock", "No response - values from 14:02:11.540"],
  ] as const)("%s shows icon and text", (kind, icon, text) => {
    const { container } = render(<FreshnessChip kind={kind}>{text}</FreshnessChip>);
    expect(container.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
    expect(screen.getByText(text)).toBeVisible();
  });
});

describe("loader and reduced motion", () => {
  it("spins by default", () => {
    mockReducedMotion(false);
    const { container } = render(
      <StatusPill variant="connecting" icon="loader" label="Connecting…" />,
    );
    expect(container.querySelector('[data-icon="loader"]')?.getAttribute("class")).toContain(
      "animate-spin",
    );
  });

  it("does not animate when the user prefers reduced motion, and the label still shows", () => {
    mockReducedMotion(true);
    const { container } = render(
      <StatusPill variant="connecting" icon="loader" label="Connecting…" />,
    );
    expect(container.querySelector('[data-icon="loader"]')?.getAttribute("class")).not.toContain(
      "animate-spin",
    );
    expect(screen.getByText("Connecting…")).toBeVisible();
  });

  it("also holds for the banner and chip loaders", () => {
    mockReducedMotion(true);
    const { container } = render(
      <>
        <StateBanner variant="neutral" icon="loader">
          Connecting…
        </StateBanner>
        <FreshnessChip kind="loading">Waiting for first response…</FreshnessChip>
      </>,
    );
    for (const el of container.querySelectorAll('[data-icon="loader"]')) {
      expect(el.getAttribute("class")).not.toContain("animate-spin");
    }
  });
});

describe("StatusStrip", () => {
  it.each([
    ["none", "bg-card"],
    ["warning", "bg-warning"],
    ["error", "bg-error-tint"],
    ["neutral", "bg-neutral-tint"],
  ] as const satisfies ReadonlyArray<readonly [StripTone, string]>)("%s tone", (tone, cls) => {
    const { container } = render(<StatusStrip tone={tone}>text</StatusStrip>);
    expect(container.firstElementChild).toHaveAttribute("data-tone", tone);
    expect(container.firstElementChild?.className).toContain(cls);
  });

  it("keeps the text dark: never text on a solid error fill", () => {
    const { container } = render(<StatusStrip tone="error">x</StatusStrip>);
    expect(container.firstElementChild?.className.split(" ")).not.toContain("bg-error");
    const { container: warn } = render(<StatusStrip tone="warning">x</StatusStrip>);
    expect(warn.firstElementChild?.className).toContain("text-dark");
  });
});
