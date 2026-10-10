package hubserver

import "time"

const (
	labelManagedBy      = "app.kubernetes.io/managed-by"
	labelDevice         = "hindsight.leetserve.com/device"
	annotationHeartbeat = "hindsight.leetserve.com/last-heartbeat"
	annotationVersion   = "hindsight.leetserve.com/version"
	managedBy           = "hindsight-hub"
	recordTTL           = 60
)

// DNSEndpointSpec is external-dns's DNSEndpoint spec, as much as the hub sets.
type DNSEndpointSpec struct {
	Endpoints []Endpoint `json:"endpoints"`
}

// Endpoint is one record of a DNSEndpoint.
type Endpoint struct {
	DNSName    string   `json:"dnsName"`
	RecordType string   `json:"recordType"`
	Targets    []string `json:"targets"`
	RecordTTL  int64    `json:"recordTTL"`
}

// CertificateSpec is cert-manager's Certificate spec, as much as the hub sets.
type CertificateSpec struct {
	SecretName string    `json:"secretName"`
	DNSNames   []string  `json:"dnsNames"`
	IssuerRef  IssuerRef `json:"issuerRef"`
}

// IssuerRef names a cert-manager issuer.
type IssuerRef struct {
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Group string `json:"group"`
}

// meta is the metadata both of a device's objects carry. The heartbeat
// annotations make each apply a small write rather than a no-op; that is the
// visibility the spec asks for, at one write per device per heartbeat.
func (s *Server) meta(name string, now time.Time, version string) ObjectMeta {
	m := ObjectMeta{
		Name:      name,
		Namespace: s.cfg.Namespace,
		Labels: map[string]string{
			labelManagedBy: managedBy,
			labelDevice:    name,
		},
		Annotations: map[string]string{
			annotationHeartbeat: now.UTC().Format(time.RFC3339),
		},
	}
	if version != "" {
		m.Annotations[annotationVersion] = version
	}
	return m
}

func (s *Server) dnsEndpoint(name, recordType, ip string, meta ObjectMeta) Object {
	return Object{
		APIVersion: "externaldns.k8s.io/v1alpha1",
		Kind:       "DNSEndpoint",
		Metadata:   meta,
		Spec: DNSEndpointSpec{Endpoints: []Endpoint{{
			DNSName:    s.fqdn(name),
			RecordType: recordType,
			Targets:    []string{ip},
			RecordTTL:  recordTTL,
		}}},
	}
}

func (s *Server) certificateObject(name string, meta ObjectMeta) Object {
	return Object{
		APIVersion: "cert-manager.io/v1",
		Kind:       "Certificate",
		Metadata:   meta,
		Spec: CertificateSpec{
			SecretName: name + "-tls",
			DNSNames:   []string{s.fqdn(name)},
			IssuerRef:  IssuerRef{Name: s.cfg.Issuer, Kind: s.cfg.IssuerKind, Group: "cert-manager.io"},
		},
	}
}
