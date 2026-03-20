import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center py-20">
      <Card className="w-full max-w-sm mx-4">
        <CardContent className="pt-6 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold mb-1">Page Not Found</h1>
          <p className="text-sm text-muted-foreground mb-4">
            This page doesn't exist or you don't have access.
          </p>
          <Link href="/">
            <Button variant="outline" className="w-full">
              <Home className="w-4 h-4 mr-1.5" />
              Go to Dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
