import { Choice } from "@/components/choice";
import { Field } from "@/components/field";
import { PrimaryButton } from "@/components/primary-button";
import { Centered, ScreenScroll } from "@/components/screen";
import { TextButton } from "@/components/text-button";
import {
  archiveList,
  assignFolder,
  createFolder,
  createList,
  createSection,
  deleteFolder,
  loadFolders,
  loadLists,
  recolorList,
  renameFolder,
  renameList,
  reorderFolders,
  reorderLists,
  type Folder,
} from "@/db/lists";
import { usePhone } from "@/state/phone";
import { colors, ink } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { DEFAULT_LIST_COLOR, STICKERS, movedIds, type TaskList } from "@layp/shared";
import { Redirect, Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

export function ListsScreen() {
  usePaper();
  const phone = usePhone();
  const [lists, setLists] = useState<TaskList[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    void Promise.all([loadLists(), loadFolders()]).then(
      ([nextLists, nextFolders]) => {
        if (cancel) return;
        setLists(nextLists);
        setFolders(nextFolders);
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load lists.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, retry]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && lists === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  const loose = (lists ?? []).filter((list) => !list.isInbox && list.folderId === null);

  function fail(message: string) {
    setError(message);
  }

  async function moveFolder(id: string, direction: -1 | 1) {
    const next = movedIds(
      folders.map((folder) => folder.id),
      id,
      direction,
    );
    if (!next) return;
    const result = await reorderFolders(next);
    if (result === "error") fail("Not saved");
    else phone.changed();
  }

  return (
    <ScreenScroll>
      <Stack.Title>Lists</Stack.Title>
      {lists === null ? <Text style={{ color: colors.label }}>Loading lists…</Text> : null}
      {error && lists !== null ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {lists !== null && loose.length === 0 && folders.length === 0 ? (
        <Text style={{ color: colors.label, fontSize: 17 }}>Add a list.</Text>
      ) : null}
      {loose.map((list) => (
        <ListCard key={list.id} list={list} lists={lists ?? []} folders={folders} onError={fail} />
      ))}
      <NewList onError={fail} />
      <NewFolder onError={fail} />
      {folders.map((folder, index) => {
        const inside = (lists ?? []).filter((list) => list.folderId === folder.id && !list.isInbox);
        const open = openFolders[folder.id] ?? inside.length <= 3;
        return (
          <View key={folder.id} style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              onPress={() => setOpenFolders((current) => ({ ...current, [folder.id]: !open }))}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>
                {open ? "▾" : "▸"} {folder.name}
              </Text>
            </Pressable>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <TextButton label="Up" disabled={index === 0} onPress={() => void moveFolder(folder.id, -1)} />
              <TextButton label="Down" disabled={index === folders.length - 1} onPress={() => void moveFolder(folder.id, 1)} />
              <FolderRename folder={folder} onError={fail} />
              <FolderDelete folder={folder} onError={fail} />
            </View>
            {open
              ? inside.map((list) => <ListCard key={list.id} list={list} lists={lists ?? []} folders={folders} onError={fail} />)
              : null}
          </View>
        );
      })}
    </ScreenScroll>
  );
}

function NewList({ onError }: { onError: (message: string) => void }) {
  const phone = usePhone();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_LIST_COLOR);
  const [open, setOpen] = useState(false);
  if (!open) return <TextButton label="New list" onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 8 }}>
      <Field label="List name" value={name} onChangeText={setName} maxLength={80} />
      <Swatches color={color} onChange={setColor} />
      <PrimaryButton
        label="Create list"
        onPress={() => {
          void createList(name, color).then((result) => {
            if (result.status !== "saved") {
              onError(result.status === "error" ? result.message : "Not saved");
              return;
            }
            setName("");
            setColor(DEFAULT_LIST_COLOR);
            setOpen(false);
            phone.changed();
          });
        }}
      />
    </View>
  );
}

function NewFolder({ onError }: { onError: (message: string) => void }) {
  const phone = usePhone();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  if (!open) return <TextButton label="New folder" onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 8 }}>
      <Field label="Folder name" value={name} onChangeText={setName} maxLength={80} />
      <PrimaryButton
        label="Create folder"
        onPress={() => {
          void createFolder(name).then((result) => {
            if (result.status !== "saved") {
              onError(result.status === "error" ? result.message : "Not saved");
              return;
            }
            setName("");
            setOpen(false);
            phone.changed();
          });
        }}
      />
    </View>
  );
}

function ListCard({
  list,
  lists,
  folders,
  onError,
}: {
  list: TaskList;
  lists: TaskList[];
  folders: Folder[];
  onError: (message: string) => void;
}) {
  const phone = usePhone();
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState(list.name);
  const [sectionName, setSectionName] = useState("");
  const siblings = lists.filter((item) => !item.isInbox && item.folderId === list.folderId);
  const index = siblings.findIndex((item) => item.id === list.id);

  async function move(direction: -1 | 1) {
    const next = movedIds(
      siblings.map((item) => item.id),
      list.id,
      direction,
    );
    if (!next) return;
    const siblingSet = new Set(siblings.map((item) => item.id));
    const ordered: string[] = [];
    let placed = false;
    for (const item of lists) {
      if (siblingSet.has(item.id)) {
        if (!placed) {
          ordered.push(...next);
          placed = true;
        }
      } else ordered.push(item.id);
    }
    const result = await reorderLists(ordered);
    if (result === "error") onError("Not saved");
    else phone.changed();
  }

  return (
    <View style={{ gap: 8, paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: list.color }} />
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/more/list/[id]", params: { id: list.id } })} style={{ flex: 1, minHeight: 40, justifyContent: "center" }}>
          <Text style={{ color: colors.label, fontSize: 17 }}>{list.name}</Text>
        </Pressable>
        <TextButton label={menu ? "Close" : "Menu"} onPress={() => setMenu((value) => !value)} />
      </View>
      {menu ? (
        <View style={{ gap: 8, paddingLeft: 8 }}>
          <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
          <TextButton
            label="Rename"
            onPress={() => {
              void renameList(list, name).then((result) => {
                if (result.status !== "saved") onError(result.status === "error" ? result.message : "Not saved");
                else phone.changed();
              });
            }}
          />
          <Swatches
            color={list.color}
            onChange={(hex) => {
              void recolorList(list, hex).then((result) => {
                if (result.status !== "saved") onError(result.status === "error" ? result.message : "Not saved");
                else phone.changed();
              });
            }}
          />
          <Choice
            label="Folder"
            value={list.folderId ?? ""}
            options={[{ value: "", label: "No folder" }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
            onChange={(folderId) => {
              void assignFolder(list, folderId || null).then((result) => {
                if (result.status !== "saved") onError(result.status === "error" ? result.message : "Not saved");
                else phone.changed();
              });
            }}
          />
          <View style={{ flexDirection: "row" }}>
            <TextButton label="Up" disabled={index <= 0} onPress={() => void move(-1)} />
            <TextButton label="Down" disabled={index < 0 || index >= siblings.length - 1} onPress={() => void move(1)} />
          </View>
          <Field label="New section" value={sectionName} onChangeText={setSectionName} maxLength={80} />
          <TextButton
            label="Add section"
            onPress={() => {
              void createSection(list.id, sectionName).then((result) => {
                if (result.status !== "saved") onError(result.message);
                else {
                  setSectionName("");
                  phone.changed();
                }
              });
            }}
          />
          <TextButton
            label="Archive"
            onPress={() => {
              void archiveList(list).then((result) => {
                if (result.status !== "saved") onError(result.status === "error" ? result.message : "Not saved");
                else phone.changed();
              });
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function FolderRename({ folder, onError }: { folder: Folder; onError: (message: string) => void }) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(folder.name);
  if (!open) return <TextButton label="Rename" onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 8, width: "100%" }}>
      <Field label={`Rename ${folder.name}`} value={name} onChangeText={setName} maxLength={80} />
      <View style={{ flexDirection: "row" }}>
        <TextButton
          label="Save"
          onPress={() => {
            void renameFolder(folder, name).then((result) => {
              if (result.status !== "saved") onError(result.status === "error" ? result.message : "Not saved");
              else {
                setOpen(false);
                phone.changed();
              }
            });
          }}
        />
        <TextButton label="Cancel" onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

function FolderDelete({ folder, onError }: { folder: Folder; onError: (message: string) => void }) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  if (!open) return <TextButton label="Delete" onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 8, width: "100%" }}>
      <Text selectable style={{ color: colors.label }}>Lists in this folder stay, with no folder.</Text>
      <View style={{ flexDirection: "row" }}>
        <TextButton
          label="Delete"
          onPress={() => {
            void deleteFolder(folder.id).then((result) => {
              if (result.status !== "saved") onError(result.status === "error" ? result.message : "Not saved");
              else phone.changed();
            });
          }}
        />
        <TextButton label="Cancel" onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

function Swatches({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  usePaper();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {STICKERS.map((sticker) => {
        const selected = sticker.hex === color.toLowerCase();
        return (
          <Pressable
            key={sticker.hex}
            accessibilityRole="button"
            accessibilityLabel={sticker.name}
            onPress={() => onChange(sticker.hex)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: sticker.hex,
              borderWidth: selected ? 2 : 0,
              borderColor: ink,
            }}
          />
        );
      })}
    </View>
  );
}
