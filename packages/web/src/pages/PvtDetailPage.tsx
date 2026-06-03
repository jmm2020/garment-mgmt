import { useParams } from "react-router-dom";

export function PvtDetailPage() {
  const { runNo = "" } = useParams();
  return (
    <div>
      <h1>PVT Run {runNo}</h1>
      {/* TODO: PVT detail via useQuery(get(`/api/pvt/${runNo}`)) — iter 3 */}
      <p>TODO: PVT detail</p>
    </div>
  );
}
