import requests
import json
import time

BASE_URL = "http://localhost:8000/api/v1/auth"

# 创建一个 Session 对象，它会自动处理 Cookies (Session ID)
session = requests.Session()

def print_response(response, action):
    print(f"--- {action} ---")
    print(f"Status Code: {response.status_code}")
    try:
        print(f"Response: {json.dumps(response.json(), indent=2)}")
    except:
        print(f"Response: {response.text}")
    print("-" * 20)

def test_auth_flow():
    username = f"testuser_{int(time.time())}"
    password = "password123"
    name = "Test User"

    # 1. 注册 (Register)
    print(f"\n[1] Registering user: {username}")
    res = session.post(f"{BASE_URL}/register", json={
        "username": username,
        "password": password,
        "name": name
    })
    print_response(res, "Register")

    # 2. 登录 (Login)
    print(f"\n[2] Logging in as: {username}")
    res = session.post(f"{BASE_URL}/login", json={
        "username": username,
        "password": password
    })
    print_response(res, "Login")
    
    if res.status_code != 200:
        print("Login failed, stopping test.")
        return

    # 3. 验证 Session (Validate) - 应该成功
    print(f"\n[3] Validating Session (Should be logged in)")
    res = session.get(f"{BASE_URL}/validate")
    print_response(res, "Validate (LoggedIn)")

    # 4. 登出 (Logout)
    print(f"\n[4] Logging out")
    res = session.post(f"{BASE_URL}/logout")
    print_response(res, "Logout")

    # 5. 再次验证 Session (Validate) - 应该失败
    print(f"\n[5] Validating Session (Should be logged out)")
    res = session.get(f"{BASE_URL}/validate")
    print_response(res, "Validate (LoggedOut)")

if __name__ == "__main__":
    try:
        test_auth_flow()
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to server. Make sure 'node .js' is running!")
