"""局域网 HTTPS 两级自签名证书（本地 Root CA + 服务器证书）生成与校验工具。"""
from datetime import datetime, timedelta, timezone
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
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


def ensure_ca_cert(cert_dir):
    """确保本地 Root CA 存在且有效，返回 (ca_cert, ca_key, ca_cert_path, regenerated)。"""
    cert_dir = Path(cert_dir)
    cert_dir.mkdir(parents=True, exist_ok=True)
    ca_cert_path = cert_dir / "ca.crt"
    ca_key_path = cert_dir / "ca.key"

    if ca_cert_path.is_file() and ca_key_path.is_file():
        try:
            ca_cert = x509.load_pem_x509_certificate(ca_cert_path.read_bytes())
            ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password=None)
            if ca_cert.not_valid_after_utc > datetime.now(timezone.utc) + timedelta(days=30):
                return ca_cert, ca_key, ca_cert_path, False
        except Exception:
            pass

    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Shanhai AI Classroom Root CA"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Shanhai AI"),
    ])

    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )

    ca_key_path.write_bytes(
        ca_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    ca_cert_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    return ca_cert, ca_key, ca_cert_path, True


def _server_cert_matches(server_cert_path, server_key_path, ca_cert, target_ips):
    if not server_cert_path.is_file() or not server_key_path.is_file():
        return False
    try:
        server_cert = x509.load_pem_x509_certificate(server_cert_path.read_bytes())
        if server_cert.not_valid_after_utc <= datetime.now(timezone.utc) + timedelta(days=30):
            return False
        # 校验确实由当前 Root CA 签发
        ca_cert.public_key().verify(
            server_cert.signature,
            server_cert.tbs_certificate_bytes,
            padding.PKCS1v15(),
            server_cert.signature_hash_algorithm,
        )
        san = server_cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        existing_ips = set(san.get_values_for_type(x509.IPAddress))
        return all(ip in existing_ips for ip in target_ips)
    except Exception:
        return False


def ensure_lan_cert(cert_dir, ips=None):
    """确保 Root CA 与覆盖当前局域网 IP 的服务器证书均有效，返回 (server_crt, server_key, ca_crt, regenerated)。"""
    cert_dir = Path(cert_dir)
    ca_cert, ca_key, ca_cert_path, ca_regen = ensure_ca_cert(cert_dir)

    server_cert_path = cert_dir / "server.crt"
    server_key_path = cert_dir / "server.key"
    target_ips = _normalize_ipv4(ips)

    if not ca_regen and _server_cert_matches(server_cert_path, server_key_path, ca_cert, target_ips):
        return server_cert_path, server_key_path, ca_cert_path, False

    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Shanhai AI Classroom Server"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Shanhai AI"),
    ])
    san_entries = [x509.DNSName("localhost")] + [x509.IPAddress(ip) for ip in target_ips]

    server_cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
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
        .sign(ca_key, hashes.SHA256())
    )

    server_key_path.write_bytes(
        server_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    chain_pem = server_cert.public_bytes(serialization.Encoding.PEM) + ca_cert.public_bytes(serialization.Encoding.PEM)
    server_cert_path.write_bytes(chain_pem)
    return server_cert_path, server_key_path, ca_cert_path, True
