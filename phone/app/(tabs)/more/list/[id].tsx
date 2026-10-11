import { ListScreen } from "@/screens/list-screen";
import { useLocalSearchParams } from "expo-router";

function one(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ?? "";
}

export default function ListRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  return <ListScreen listId={one(params.id)} />;
}
