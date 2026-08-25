def run():
    from support_iid.api.microsoft_graph import get_employee_details
    result = get_employee_details(email="augustin.moses@azimpremjifoundation.org", funds_requested=0)
    print(result)
