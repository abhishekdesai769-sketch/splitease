import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FolderPlus, UserPlus, Upload, ChevronRight } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Group } from "@shared/schema";

export default function Import() {
  const [, setLocation] = useLocation();
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => setLocation("/expenses")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-semibold tracking-tight">Import from Splitwise</h1>
      </div>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold mb-1">How to import</h2>
          <p className="text-sm text-muted-foreground">
            Follow these 3 steps to import your Splitwise data with accurate balances.
          </p>
        </div>

        {/* Step 1 */}
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-xs font-bold text-primary">1</span>
          </div>
          <div>
            <p className="text-sm font-medium">Create a group</p>
            <p className="text-xs text-muted-foreground">
              Create a new group with the same name as your Splitwise group.
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-xs font-bold text-primary">2</span>
          </div>
          <div>
            <p className="text-sm font-medium">Invite your friends</p>
            <p className="text-xs text-muted-foreground">
              Add all the group members by email. This ensures names are matched correctly — no typos or mismatches.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-xs font-bold text-primary">3</span>
          </div>
          <div>
            <p className="text-sm font-medium">Import the CSV</p>
            <p className="text-xs text-muted-foreground">
              Open the group, tap the ⋮ menu, select "Import from Splitwise", upload your CSV, and map each person to a group member.
            </p>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            <strong>Tip:</strong> Export from Splitwise by opening a group → gear icon → Export as CSV.
          </p>
        </div>
      </Card>

      {/* Quick actions */}
      <div className="space-y-2">
        <Link href="/groups">
          <Button variant="outline" className="w-full justify-between">
            <span className="flex items-center gap-2">
              <FolderPlus className="w-4 h-4" />
              Create a new group
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Button>
        </Link>

        {groups.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground pt-2">Or import into an existing group:</p>
            {groups.map((group) => (
              <Link key={group.id} href={`/groups/${group.id}`}>
                <Card className="p-3 flex items-center gap-3 hover-elevate cursor-pointer">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Upload className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{group.name}</p>
                    <p className="text-xs text-muted-foreground">{group.memberIds.length} members</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Card>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
