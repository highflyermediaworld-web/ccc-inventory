import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { UserPlus, KeyRound, Trash2, ShieldCheck } from "lucide-react";

type AdminUser = {
  id: number;
  username: string;
  email: string;
  role: string;
  createdAt: number;
};

export default function UsersPage() {
  const { toast } = useToast();
  const { user: me } = useAuth();

  const { data, isLoading } = useQuery<{ users: AdminUser[] }>({
    queryKey: ["/api/admin/users"],
  });
  const users = data?.users ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  // Create form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // Reset form
  const [resetPwd, setResetPwd] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });

  const createMutation = useMutation({
    mutationFn: async (body: { username: string; password: string; email?: string }) => {
      return apiRequest("POST", "/api/admin/users", body);
    },
    onSuccess: () => {
      toast({ title: "Admin created", description: `${newUsername} can now sign in.` });
      setCreateOpen(false);
      setNewUsername("");
      setNewPassword("");
      setNewEmail("");
      invalidate();
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't create admin",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      return apiRequest("PATCH", `/api/admin/users/${id}/password`, { password });
    },
    onSuccess: () => {
      toast({
        title: "Password reset",
        description: `${resetTarget?.username} must sign in again.`,
      });
      setResetTarget(null);
      setResetPwd("");
      invalidate();
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't reset password",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      toast({ title: "Admin removed" });
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't remove admin",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Users"
        description="Add or remove people who can sign in to the admin app."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-admin">
                <UserPlus className="size-4 mr-2" />
                Add Admin
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create admin user</DialogTitle>
                <DialogDescription>
                  They can sign in at /login with the username and password you set.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new-username">Username</Label>
                  <Input
                    id="new-username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g. Techguy"
                    autoComplete="off"
                    data-testid="input-new-username"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-email" className="flex items-center justify-between">
                    <span>Email</span>
                    <span className="text-xs text-muted-foreground font-normal">optional</span>
                  </Label>
                  <Input
                    id="new-email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder={`${newUsername || "username"}@cpulls.cards`}
                    autoComplete="off"
                    data-testid="input-new-email"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    createMutation.mutate({
                      username: newUsername.trim(),
                      password: newPassword,
                      email: newEmail.trim() || undefined,
                    })
                  }
                  disabled={
                    createMutation.isPending ||
                    newUsername.trim().length < 2 ||
                    newPassword.length < 8
                  }
                  data-testid="button-confirm-create-admin"
                >
                  {createMutation.isPending ? "Creating…" : "Create admin"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading admins…
                </td>
              </tr>
            )}
            {!isLoading && users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No admins yet.
                </td>
              </tr>
            )}
            {users.map((u) => {
              const isMe = me?.id === u.id;
              return (
                <tr
                  key={u.id}
                  className="border-b last:border-0 hover:bg-muted/40"
                  data-testid={`row-user-${u.id}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" data-testid={`text-username-${u.id}`}>
                        {u.username}
                      </span>
                      {isMe && (
                        <span className="text-xs rounded-full px-2 py-0.5 bg-primary/10 text-primary inline-flex items-center gap-1">
                          <ShieldCheck className="size-3" />
                          you
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{u.role}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDateTime(u.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setResetTarget(u);
                        setResetPwd("");
                      }}
                      data-testid={`button-reset-${u.id}`}
                    >
                      <KeyRound className="size-4 mr-1.5" />
                      Reset password
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(u)}
                      disabled={isMe}
                      data-testid={`button-delete-${u.id}`}
                    >
                      <Trash2 className="size-4 mr-1.5" />
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Reset password dialog */}
      <Dialog
        open={!!resetTarget}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null);
            setResetPwd("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for{" "}
              <span className="font-medium text-foreground">{resetTarget?.username}</span>. Their
              active sessions will be signed out.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="reset-pwd">New password</Label>
            <Input
              id="reset-pwd"
              type="password"
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              data-testid="input-reset-password"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                resetTarget &&
                resetMutation.mutate({ id: resetTarget.id, password: resetPwd })
              }
              disabled={resetMutation.isPending || resetPwd.length < 8}
              data-testid="button-confirm-reset"
            >
              {resetMutation.isPending ? "Saving…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this admin?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.username} will lose access immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Removing…" : "Remove admin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
