"""局域网 HTTPS 自签名证书自动生成与校验工具。"""
from datetime import datetime, timedelta, timezone
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def _normalize_ipv4(ips):
    result = []
    for raw in ["127.0.0.1", *(ips or [])]:
        try:
            addr = ipaddress.IPv4Address(str(raw).strip())
        except ValueError:
            continue
        if addr not in result:
            result.append(addr)
    return result


def _cert_matches(cert_path, key_path, target_ips):
    if not cert_path.is_file() or not key_path.is_file():
        return False
    try:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        if cert.not_valid_after_utc <= datetime.now(timezone.utc) + timedelta(days=30):
            return False
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        existing_ips = set(san.get_values_for_type(x509.IPAddress))
        return all(ip in existing_ips for ip in target_ips)
    except Exception:
        return False


def ensure_lan_cert(cert_dir, ips=None):
    """确保证书目录存在覆盖本机及局域网 IP 的有效证书，返回 (cert_path, key_path, regenerated)。"""
    cert_dir = Path(cert_dir)
    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_path = cert_dir / "server.crt"
    key_path = cert_dir / "server.key"
    target_ips = _normalize_ipv4(ips)

    if _cert_matches(cert_path, key_path, target_ips):
        return cert_path, key_path, False

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Shanhai AI Classroom"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Shanhai AI"),
    ])

    san_entries = [x509.DNSName("localhost")] + [x509.IPAddress(ip) for ip in target_ips]

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )

    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path, True
