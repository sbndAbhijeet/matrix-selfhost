/**
 * Safe password reset using Synapse Admin API
 * Works on Windows, Linux, WSL, macOS – no Docker required
 */
export async function resetUserPassword(userId, newPassword, adminToken, homeserverUrl){
    const url = `${homeserverUrl}/_synapse/admin/v2/users/${encodeURIComponent(userId)}`;

    const response = await fetch(url, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${adminToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                password: newPassword,
            }),
        });

    if(!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to reset password for ${userId}: ${response.status} – ${text}`);
    }

    return true;
}