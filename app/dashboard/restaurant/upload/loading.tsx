import { ListPageSkeleton } from "@/components/restaurant/shell/RouteSkeletons";

export default function Loading() {
  return <ListPageSkeleton cards={0} blocks={2} />;
}
