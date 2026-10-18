import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import { ContextMenu, MenuButton, type MenuEntry } from "./menu";

function entries(onSelect: (id: string) => void): MenuEntry[] {
  return [
    { kind: "heading", id: "h", label: "Show" },
    { kind: "radio", id: "raw", label: "Raw", checked: false, onSelect: () => onSelect("raw") },
    { kind: "radio", id: "both", label: "Both", checked: true, onSelect: () => onSelect("both") },
    { kind: "separator", id: "s" },
    {
      kind: "check",
      id: "alias",
      label: "Alias column",
      checked: true,
      onSelect: () => onSelect("alias"),
    },
    { kind: "item", id: "go", label: "Pause", shortcut: "Ctrl+P", onSelect: () => onSelect("go") },
    {
      kind: "item",
      id: "off",
      label: "Disabled item",
      disabled: true,
      title: "Not now",
      onSelect: () => onSelect("off"),
    },
  ];
}

describe("MenuButton", () => {
  it("opens a menu with roles, checked state and shortcuts", async () => {
    const user = userEvent.setup();
    render(
      <MenuButton label="Poll actions" entries={entries(() => {})}>
        More
      </MenuButton>,
    );
    const button = screen.getByRole("button", { name: "Poll actions" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Poll actions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Both" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Raw" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("menuitemcheckbox", { name: "Alias column" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: /Pause/ })).toHaveTextContent("Ctrl+P");
    expect(screen.getByRole("menuitem", { name: "Disabled item" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "Disabled item" })).toHaveAttribute(
      "title",
      "Not now",
    );
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("focuses the first enabled entry; arrows, Home and End move and wrap, disabled entries included", async () => {
    const user = userEvent.setup();
    render(
      <MenuButton label="Menu" entries={entries(() => {})}>
        More
      </MenuButton>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("menuitemradio", { name: "Raw" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Both" })).toHaveFocus();
    await user.keyboard("{End}");
    // The disabled entry is reachable: its title says why it is off (REV-006 n-10).
    const off = screen.getByRole("menuitem", { name: "Disabled item" });
    expect(off).toHaveFocus();
    expect(off).toHaveAttribute("aria-disabled", "true");
    expect(off).toHaveAttribute("title", "Not now");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Raw" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(off).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: /Pause/ })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitemradio", { name: "Raw" })).toHaveFocus();
  });

  it("Enter on a disabled entry does nothing and keeps the menu open", async () => {
    const user = userEvent.setup();
    const chosen = vi.fn();
    render(
      <MenuButton label="Menu" entries={entries(chosen)}>
        More
      </MenuButton>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.keyboard("{End}{Enter}");
    expect(chosen).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("a menu of only disabled entries still takes the focus", async () => {
    const user = userEvent.setup();
    render(
      <MenuButton
        label="Menu"
        entries={[
          {
            kind: "item",
            id: "a",
            label: "A",
            disabled: true,
            title: "Why not",
            onSelect: () => {},
          },
        ]}
      >
        More
      </MenuButton>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("menuitem", { name: "A" })).toHaveFocus();
  });

  it("Enter chooses the entry, closes the menu and gives the focus back", async () => {
    const user = userEvent.setup();
    const chosen = vi.fn();
    render(
      <MenuButton label="Menu" entries={entries(chosen)}>
        More
      </MenuButton>,
    );
    const button = screen.getByRole("button", { name: "Menu" });
    await user.click(button);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(chosen).toHaveBeenCalledWith("both");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("a disabled entry does nothing", async () => {
    const user = userEvent.setup();
    const chosen = vi.fn();
    render(
      <MenuButton label="Menu" entries={entries(chosen)}>
        More
      </MenuButton>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Disabled item" }));
    expect(chosen).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("Esc closes and returns the focus; Tab closes", async () => {
    const user = userEvent.setup();
    render(
      <MenuButton label="Menu" entries={entries(() => {})}>
        More
      </MenuButton>,
    );
    const button = screen.getByRole("button", { name: "Menu" });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clicking the button again, or outside, closes it", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Elsewhere</button>
        <MenuButton label="Menu" entries={entries(() => {})}>
          More
        </MenuButton>
      </div>,
    );
    const button = screen.getByRole("button", { name: "Menu" });
    await user.click(button);
    await user.click(button);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("ArrowDown on the button opens the menu", async () => {
    const user = userEvent.setup();
    render(
      <MenuButton label="Menu" entries={entries(() => {})}>
        More
      </MenuButton>,
    );
    screen.getByRole("button", { name: "Menu" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("a disabled button does not open", async () => {
    const user = userEvent.setup();
    render(
      <MenuButton label="Menu" entries={entries(() => {})} disabled>
        More
      </MenuButton>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("ContextMenu", () => {
  function Harness({ onSelect }: { onSelect: (id: string) => void }) {
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    return (
      <>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a test surface for the context menu. */}
        <div
          data-testid="area"
          onContextMenu={(e) => {
            e.preventDefault();
            setPosition({ x: e.clientX, y: e.clientY });
          }}
        >
          area
        </div>
        <ContextMenu
          position={position}
          label="Row actions"
          entries={entries(onSelect)}
          onClose={() => setPosition(null)}
        />
      </>
    );
  }

  it("opens at the pointer and closes after a choice", async () => {
    const user = userEvent.setup();
    const chosen = vi.fn();
    render(<Harness onSelect={chosen} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("area") });
    const menu = screen.getByRole("menu", { name: "Row actions" });
    expect(menu).toHaveStyle({ position: "fixed" });
    await user.click(screen.getByRole("menuitem", { name: /Pause/ }));
    expect(chosen).toHaveBeenCalledWith("go");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders nothing without a position", () => {
    render(<ContextMenu position={null} entries={[]} label="x" onClose={() => {}} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("MenuButton wiring (REV-005 m-3, n-3)", () => {
  it("aria-controls points at the id of the open menu", async () => {
    const user = userEvent.setup();
    render(
      <MenuButton label="Poll actions" entries={entries(() => {})}>
        More
      </MenuButton>,
    );
    const button = screen.getByRole("button", { name: "Poll actions" });
    await user.click(button);
    const menu = screen.getByRole("menu");
    expect(menu.id).not.toBe("");
    expect(button).toHaveAttribute("aria-controls", menu.id);
  });

  it("an open menu keeps its outside-click listener when the parent renders again", async () => {
    const user = userEvent.setup();
    function Parent() {
      const [n, setN] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setN(n + 1)}>
            tick {n}
          </button>
          <MenuButton label="Poll actions" entries={entries(() => {})}>
            More
          </MenuButton>
        </>
      );
    }
    render(<Parent />);
    await user.click(screen.getByRole("button", { name: "Poll actions" }));
    const add = vi.spyOn(document, "addEventListener");
    // The tick button is outside the menu: the click closes it, so keep the menu open by
    // re-rendering from a keyboard activation instead.
    screen.getByRole("button", { name: /tick/ }).focus();
    await user.keyboard("{Enter}");
    const pointerdownListeners = add.mock.calls.filter(([type]) => type === "pointerdown");
    expect(pointerdownListeners).toHaveLength(0);
    add.mockRestore();
  });
});

describe("submenus", () => {
  function withSubmenu(select: (id: string) => void, onOpen = () => {}): MenuEntry[] {
    return [
      { kind: "item", id: "tile", label: "Tile", onSelect: () => select("tile") },
      {
        kind: "submenu",
        id: "popped",
        label: "Popped-out windows",
        onOpen,
        entries: [
          { kind: "item", id: "t2", label: "Tile natives", onSelect: () => select("t2") },
          { kind: "heading", id: "h", label: "Arrange on:" },
          {
            kind: "radio",
            id: "r1",
            label: "Display 1",
            checked: true,
            onSelect: () => select("r1"),
          },
          {
            kind: "radio",
            id: "r2",
            label: "Display 2",
            checked: false,
            onSelect: () => select("r2"),
          },
        ],
      },
      { kind: "item", id: "last", label: "Last", onSelect: () => select("last") },
    ];
  }

  async function openMenu(select = vi.fn(), onOpen = vi.fn()) {
    const user = userEvent.setup();
    render(
      <MenuButton label="Window" entries={withSubmenu(select, onOpen)}>
        Window
      </MenuButton>,
    );
    await user.click(screen.getByRole("button", { name: "Window" }));
    return { user, select, onOpen };
  }

  it("shows a submenu entry with aria-haspopup and an arrow, closed at first", async () => {
    await openMenu();
    const trigger = screen.getByRole("menuitem", { name: "Popped-out windows" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.querySelector('[data-icon="chevron-right"]')).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "Popped-out windows" })).not.toBeInTheDocument();
  });

  it("a click opens the second list beside it, focuses its first entry and tells the owner", async () => {
    const { user, onOpen } = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Popped-out windows" }));
    const sub = screen.getByRole("menu", { name: "Popped-out windows" });
    expect(sub).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Popped-out windows" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "Tile natives" })).toHaveFocus();
    expect(screen.getByRole("menuitemradio", { name: "Display 1" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(onOpen).toHaveBeenCalledOnce();
    // The first menu is still open.
    expect(screen.getByRole("menu", { name: "Window" })).toBeInTheDocument();
  });

  it("a second click on the entry closes the submenu again", async () => {
    const { user } = await openMenu();
    const trigger = screen.getByRole("menuitem", { name: "Popped-out windows" });
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("menu", { name: "Popped-out windows" })).not.toBeInTheDocument();
  });

  it("Right opens it from the keyboard; Left and Esc go back to the entry and keep the first menu", async () => {
    const { user } = await openMenu();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Popped-out windows" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("menu", { name: "Popped-out windows" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Tile natives" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("menu", { name: "Popped-out windows" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Popped-out windows" })).toHaveFocus();
    expect(screen.getByRole("menu", { name: "Window" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}{Escape}");
    expect(screen.queryByRole("menu", { name: "Popped-out windows" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Popped-out windows" })).toHaveFocus();
    // A second Esc closes the first menu and gives the focus back to its button.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Window" })).toHaveFocus();
  });

  it("the arrows of the submenu move inside it, not in the first menu", async () => {
    const { user } = await openMenu();
    await user.keyboard("{ArrowDown}{ArrowRight}");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Display 1" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitemradio", { name: "Display 2" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    // Wraps inside the submenu.
    expect(screen.getByRole("menuitem", { name: "Tile natives" })).toHaveFocus();
  });

  it("choosing an entry of the submenu runs it and closes both lists", async () => {
    const { user, select } = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Popped-out windows" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Display 2" }));
    expect(select).toHaveBeenCalledWith("r2");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Window" })).toHaveFocus();
  });

  it("a press inside the submenu is not an outside click; one elsewhere closes everything", async () => {
    const { user } = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Popped-out windows" }));
    await user.pointer({
      keys: "[MouseLeft>]",
      target: screen.getByRole("menuitem", { name: "Tile natives" }),
    });
    expect(screen.getByRole("menu", { name: "Window" })).toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Popped-out windows" })).toBeInTheDocument();
    await user.pointer({ keys: "[/MouseLeft]" });
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("choosing an entry of the first menu while the submenu is open runs it and closes both", async () => {
    const { user, select } = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Popped-out windows" }));
    await user.click(screen.getByRole("menuitem", { name: "Last" }));
    expect(select).toHaveBeenCalledWith("last");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("a disabled submenu does not open, and shows its title", async () => {
    const user = userEvent.setup();
    render(
      <MenuButton
        label="Window"
        entries={[
          {
            kind: "submenu",
            id: "popped",
            label: "Popped-out windows",
            disabled: true,
            title: "No poll is open in its own window.",
            entries: [{ kind: "item", id: "x", label: "X", onSelect: () => {} }],
          },
        ]}
      >
        Window
      </MenuButton>,
    );
    await user.click(screen.getByRole("button", { name: "Window" }));
    const trigger = screen.getByRole("menuitem", { name: "Popped-out windows" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("title", "No poll is open in its own window.");
    await user.click(trigger);
    expect(screen.queryByRole("menu", { name: "Popped-out windows" })).not.toBeInTheDocument();
  });

  it("works in a context menu too", async () => {
    const user = userEvent.setup();
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        label="Context"
        entries={withSubmenu(() => {})}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole("menuitem", { name: "Popped-out windows" }));
    expect(screen.getByRole("menu", { name: "Popped-out windows" })).toBeInTheDocument();
  });
});
