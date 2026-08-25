import json
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def run():
    from support_iid.api.microsoft_graph import get_employee_details, AES_KEY
    result = get_employee_details(email="augustin.moses@azimpremjifoundation.org", funds_requested=0)
    aesgcm = AESGCM(AES_KEY)
    iv = base64.b64decode(result["iv"])
    data = base64.b64decode(result["data"])
    plaintext = aesgcm.decrypt(iv, data, None)
    print(json.dumps(json.loads(plaintext), indent=2))
