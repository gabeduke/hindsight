package hubserver

import (
	"crypto/x509"
	"encoding/pem"
	"strings"
	"time"
)

// certStatus is what the hub knows of a device's certificate from its Secret.
type certStatus struct {
	Ready    bool
	NotAfter time.Time // zero when there is no parsable leaf
	Serial   string    // lowercase hex, for the ETag
}

// readCert parses the leaf of a kubernetes.io/tls Secret's tls.crt. It is
// ready when that leaf names fqdn, is inside its validity window, and the
// Secret holds a key to go with it.
func readCert(data map[string][]byte, fqdn string, now time.Time) certStatus {
	var st certStatus
	crt := data["tls.crt"]
	if len(crt) == 0 {
		return st
	}
	var leaf *x509.Certificate
	for rest := crt; ; {
		var b *pem.Block
		b, rest = pem.Decode(rest)
		if b == nil {
			break
		}
		if b.Type == "CERTIFICATE" {
			c, err := x509.ParseCertificate(b.Bytes)
			if err != nil {
				return st
			}
			leaf = c
			break
		}
	}
	if leaf == nil {
		return st
	}
	st.NotAfter = leaf.NotAfter.UTC()
	st.Serial = strings.ToLower(leaf.SerialNumber.Text(16))
	named := false
	for _, n := range leaf.DNSNames {
		if strings.EqualFold(n, fqdn) {
			named = true
		}
	}
	st.Ready = named && len(data["tls.key"]) > 0 &&
		!now.Before(leaf.NotBefore) && now.Before(leaf.NotAfter)
	return st
}
