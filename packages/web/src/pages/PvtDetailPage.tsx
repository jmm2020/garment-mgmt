import { useParams } from "react-router-dom";

export function PvtDetailPage() {
  const { runNo } = useParams<{ runNo: string }>();
  if (!runNo) return null;
  return (
    <div>
      <h1>PVT Run {runNo}</h1>
      {/* TODO iter 3: useQuery({ queryKey: ['pvt', runNo], queryFn: () => get<PvtSummary>('/api/pvt/' + runNo) }) */}
      <p>TODO: PVT detail</p>
    </div>
  );
}
