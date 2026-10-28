# Persist the working additional IP without a live network change

The additional Selectel port eth1 (MAC fa:16:3e:46:12:31) currently carries
136.234.17.113/24, gateway 136.234.17.1, source rule priority 12113 and routing
table 42113. These were configured with runtime ip commands. The main default
route remains via 139.100.237.1 on eth0. Do not remove the old IP/default route.

`persist.py` is read-only by default. `--save` adds only
`/etc/netplan/90-business-os-public-ip.yaml`, preserving all current YAML files.
It verifies live port identity, address, source rule, routing table, main route,
networkd state and API health. It rejects potentially conflicting definitions.

Before saving, it runs the host's own `netplan generate --root-dir` twice in
temporary directories containing snapshots of all /lib, /etc and /run Netplan
YAML. Existing generated networkd files must remain byte-identical. New files
must configure only the reviewed interface and source-policy table.

No `netplan apply`, live `netplan generate`, network daemon reload/restart,
`ip addr/route/rule` mutation, Docker change, database operation or reboot occurs.
The persistent YAML is picked up on a later boot. Actual reboot behavior has
not been tested; the host's existing runtime route stays in place.

```sh
python3 /root/bos-network-persist.py --save
python3 /root/bos-network-persist.py --rollback
```

Private backup/journal: `/root/bos-netplan-persistent-20261028`.
Rollback removes only the added YAML if still byte-identical. Existing configs
are never overwritten, and running routes are not changed by rollback.

Nine local tests cover route/identity conflicts, generated-policy checks,
temporary-root generation calls, concurrent edits, private backup and rollback.
The local environment has no Netplan binary; actual generator validation is a
mandatory preflight on the production host before any persistent file is added.

The pending domain certificate retry is a separate transient timer. Do not reboot
before it has completed. Retiring the old public IP also requires a separate
outbound-routing and attachment/backend-URL migration.
